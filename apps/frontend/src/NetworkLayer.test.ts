import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/react', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

const respond = (status: number, body: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
};

// Wait long enough for a settled promise to have settled; a pending one stays 'pending'.
const settledState = async (promise: Promise<unknown>) => {
  const state = await Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
  ]);
  return state;
};

describe('NetworkLayer', () => {
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // The ended-session flag is module state, so each test needs a fresh copy.
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
  });

  it('ends the session on a 401 and leaves the request pending instead of throwing', async () => {
    const { NetworkLayer, setAuthToken, getAuthToken } = await import('@root/NetworkLayer');
    setAuthToken('token');
    respond(401, { error: 'Unauthorized' });

    expect(await settledState(NetworkLayer.get('/hubs/1/sources'))).toBe('pending');
    expect(getAuthToken()).toBe('');
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('leaves requests that fail after the session already ended pending too', async () => {
    const { NetworkLayer, setAuthToken } = await import('@root/NetworkLayer');
    setAuthToken('token');
    respond(401, {});

    void NetworkLayer.get('/hubs/1');
    expect(await settledState(NetworkLayer.get('/hubs/1/sources'))).toBe('pending');
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('ends the session when another tab logged out and cleared the shared token', async () => {
    const { NetworkLayer, setAuthToken } = await import('@root/NetworkLayer');
    setAuthToken('token');
    localStorage.removeItem('authToken');
    respond(401, {});

    expect(await settledState(NetworkLayer.get('/hubs/1/sources'))).toBe('pending');
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('ends the session on a locked account and keeps the API message for the login page', async () => {
    const { NetworkLayer, setAuthToken } = await import('@root/NetworkLayer');
    setAuthToken('token');
    respond(429, { error_code: 'login_attempts_rate_limit_exceeded', error: 'Account locked' });

    expect(await settledState(NetworkLayer.post('/users/password', {}))).toBe('pending');
    expect(sessionStorage.getItem('sessionEndedReason')).toBe('Account locked');
  });

  it('throws a 401 when there is no session, so the login form can show it', async () => {
    const { NetworkLayer, HttpError } = await import('@root/NetworkLayer');
    respond(401, { error: 'Invalid email or password' });

    await expect(NetworkLayer.post('/users/sign_in', {})).rejects.toBeInstanceOf(HttpError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('throws other errors to the caller', async () => {
    const { NetworkLayer, HttpError, setAuthToken } = await import('@root/NetworkLayer');
    setAuthToken('token');
    respond(500, {});

    await expect(NetworkLayer.get('/hubs/1')).rejects.toBeInstanceOf(HttpError);
    expect(assign).not.toHaveBeenCalled();
  });

  describe('when the API cannot be reached', () => {
    const failToConnect = () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('throws a NetworkError and reports the API unreachable', async () => {
      const { NetworkLayer, NetworkError, isApiReachable } = await import('@root/NetworkLayer');
      failToConnect();

      await expect(NetworkLayer.get('/hubs/1')).rejects.toBeInstanceOf(NetworkError);
      expect(isApiReachable()).toBe(false);
    });

    it('reports the API reachable again on any response, even an error', async () => {
      const { NetworkLayer, isApiReachable } = await import('@root/NetworkLayer');
      failToConnect();
      await NetworkLayer.get('/hubs/1').catch(() => {});

      respond(500, {});
      await NetworkLayer.get('/hubs/1').catch(() => {});
      expect(isApiReachable()).toBe(true);
    });

    it('keeps checking until the API answers, even when nothing else is requested', async () => {
      vi.useFakeTimers();
      const { NetworkLayer, whenApiReachable } = await import('@root/NetworkLayer');
      failToConnect();
      await NetworkLayer.get('/hubs/1').catch(() => {});

      const reachable = vi.fn();
      void whenApiReachable().then(reachable);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(reachable).not.toHaveBeenCalled();

      respond(401, {});
      await vi.advanceTimersByTimeAsync(10_000);
      expect(reachable).toHaveBeenCalled();
    });

    it('waits longer after each failed check, up to a minute', async () => {
      vi.useFakeTimers();
      const { NetworkLayer, getApiReachability } = await import('@root/NetworkLayer');
      failToConnect();
      await NetworkLayer.get('/hubs/1').catch(() => {});

      const delays = [];
      for (let check = 0; check < 6; check++) {
        const delay = getApiReachability().nextProbeAt! - Date.now();
        delays.push(delay);
        await vi.advanceTimersByTimeAsync(delay);
      }

      expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    });

    it('checks right away when asked, and starts over from the shortest wait', async () => {
      vi.useFakeTimers();
      const { NetworkLayer, getApiReachability, probeApiNow } = await import('@root/NetworkLayer');
      failToConnect();
      await NetworkLayer.get('/hubs/1').catch(() => {});

      respond(200, {});
      probeApiNow();
      expect(getApiReachability().probing).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(getApiReachability()).toEqual({ reachable: true, probing: false, nextProbeAt: null });

      failToConnect();
      await NetworkLayer.get('/hubs/1').catch(() => {});
      expect(getApiReachability().nextProbeAt! - Date.now()).toBe(5_000);
    });

    it('stays reachable when a request succeeds while a slower check is still failing', async () => {
      vi.useFakeTimers();
      const { NetworkLayer, getApiReachability, probeApiNow } = await import('@root/NetworkLayer');
      failToConnect();
      await NetworkLayer.get('/hubs/1').catch(() => {});

      // The check fails a second later, after the request below has already been answered
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (!url.endsWith('/about')) return new Response('{}', { status: 200 });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        throw new TypeError('Failed to fetch');
      }));
      probeApiNow();
      await NetworkLayer.get('/hubs/1');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(getApiReachability()).toEqual({ reachable: true, probing: false, nextProbeAt: null });
    });

    it('gives up on a check that hangs and counts it as failed', async () => {
      vi.useFakeTimers();
      const { NetworkLayer, getApiReachability } = await import('@root/NetworkLayer');
      failToConnect();
      await NetworkLayer.get('/hubs/1').catch(() => {});

      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(getApiReachability().probing).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(getApiReachability()).toMatchObject({ reachable: false, probing: false });
      expect(getApiReachability().nextProbeAt! - Date.now()).toBe(10_000);
    });

    it('starts from the shortest wait when a check started while reachable fails', async () => {
      vi.useFakeTimers();
      const { NetworkLayer, getApiReachability, probeApiNow } = await import('@root/NetworkLayer');
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.endsWith('/about')) await new Promise((resolve) => setTimeout(resolve, 1_000));
        throw new TypeError('Failed to fetch');
      }));

      probeApiNow();
      await NetworkLayer.get('/hubs/1').catch(() => {});
      await vi.advanceTimersByTimeAsync(1_000);

      expect(getApiReachability().nextProbeAt! - Date.now()).toBe(5_000);
    });

    it('keeps the browser error as the cause', async () => {
      const { NetworkLayer } = await import('@root/NetworkLayer');
      failToConnect();

      await expect(NetworkLayer.get('/hubs/1')).rejects.toMatchObject({ cause: new TypeError('Failed to fetch') });
    });

    describe('reporting the outage to Sentry', () => {
      it('logs a warning as soon as the API goes down, with the request that failed', async () => {
        const { NetworkLayer } = await import('@root/NetworkLayer');
        const Sentry = await import('@sentry/react');
        failToConnect();

        await NetworkLayer.get('/hubs/1/conversations?search=secret').catch(() => {});
        await NetworkLayer.post('/hubs/1/notes', {}).catch(() => {});

        expect(Sentry.logger.warn).toHaveBeenCalledExactlyOnceWith('API unreachable', {
          failedRequest: 'GET /hubs/1/conversations',
          error: 'Failed to fetch',
          browserOnline: true,
        });
        expect(Sentry.logger.info).not.toHaveBeenCalled();
      });

      it('logs again once the API is back, with how long it was down', async () => {
        vi.useFakeTimers();
        const { NetworkLayer } = await import('@root/NetworkLayer');
        const Sentry = await import('@sentry/react');
        failToConnect();
        await NetworkLayer.get('/hubs/1/conversations?search=secret').catch(() => {});

        await vi.advanceTimersByTimeAsync(3_000);
        respond(200, {});
        await NetworkLayer.get('/hubs/1');

        expect(Sentry.logger.info).toHaveBeenCalledExactlyOnceWith('API reachable again', {
          durationMs: 3_000,
          failedRequest: 'GET /hubs/1/conversations',
          error: 'Failed to fetch',
          browserOnline: true,
        });
      });

      it('logs each outage separately', async () => {
        const { NetworkLayer } = await import('@root/NetworkLayer');
        const Sentry = await import('@sentry/react');

        for (let outage = 0; outage < 2; outage++) {
          failToConnect();
          await NetworkLayer.get('/hubs/1').catch(() => {});
          respond(200, {});
          await NetworkLayer.get('/hubs/1');
        }

        expect(Sentry.logger.warn).toHaveBeenCalledTimes(2);
        expect(Sentry.logger.info).toHaveBeenCalledTimes(2);
      });

      it('reports an outage found by a check that timed out', async () => {
        vi.useFakeTimers();
        const { probeApiNow } = await import('@root/NetworkLayer');
        const Sentry = await import('@sentry/react');
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })));

        probeApiNow();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(Sentry.logger.warn).toHaveBeenCalledExactlyOnceWith('API unreachable', expect.objectContaining({
          failedRequest: 'GET /about',
          error: 'No response after 10000ms',
        }));
      });

      it('does not log while the API stays reachable', async () => {
        const { NetworkLayer } = await import('@root/NetworkLayer');
        const Sentry = await import('@sentry/react');
        respond(500, {});

        await NetworkLayer.get('/hubs/1').catch(() => {});

        expect(Sentry.logger.warn).not.toHaveBeenCalled();
        expect(Sentry.logger.info).not.toHaveBeenCalled();
      });
    });

    it('does not treat a cancelled request as a lost connection', async () => {
      const { NetworkLayer, isApiReachable } = await import('@root/NetworkLayer');
      vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));

      await expect(NetworkLayer.get('/hubs/1')).rejects.toMatchObject({ name: 'AbortError' });
      expect(isApiReachable()).toBe(true);
    });
  });
});
