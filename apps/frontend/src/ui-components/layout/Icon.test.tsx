import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import Icon from './Icon';

const svgResponse = (innerHTML: string, viewBox = '0 0 24 24') =>
  `<svg xmlns="http://www.w3.org/2000/svg"><defs><symbol viewBox="${viewBox}" id="icon">${innerHTML}</symbol></defs></svg>`;

describe('Icon', () => {
  it('references the sprite file via <use> by default', () => {
    const { container } = render(<Icon id="whatsapp" />);

    expect(container.querySelector('use')).toHaveAttribute('href', '/assets/icons/whatsapp.svg?#icon');
  });

  it('renders a title element when title is provided', () => {
    render(<Icon id="whatsapp" title="WhatsApp" />);

    expect(screen.getByTitle('WhatsApp')).toBeInTheDocument();
  });

  it('passes through className and other props by default', () => {
    const { container } = render(<Icon id="whatsapp" className="custom" aria-label="WhatsApp" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveClass('custom', 'suwali-icon');
    expect(svg).toHaveAttribute('aria-label', 'WhatsApp');
  });

  it('fetches and inlines the icon markup when inlineSvg is set, instead of using <use>', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(svgResponse('<path d="M1 1" fill="url(#test_gradient)" />')),
    }));

    const { container } = render(<Icon inlineSvg id="gradient-icon-a" />);

    await waitFor(() => expect(container.querySelector('path')).toBeInTheDocument());

    expect(fetch).toHaveBeenCalledWith('/assets/icons/gradient-icon-a.svg');
    expect(container.querySelector('use')).not.toBeInTheDocument();
  });

  it('passes through className and other props when inlined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(svgResponse('<path d="M1 1" />')),
    }));

    const { container } = render(<Icon inlineSvg id="gradient-icon-b" className="custom" aria-label="Gradient" />);

    await waitFor(() => expect(container.querySelector('path')).toBeInTheDocument());

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('custom', 'suwali-icon');
    expect(svg).toHaveAttribute('aria-label', 'Gradient');
  });

  it('uses the fetched symbol viewBox when inlined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(svgResponse('<path d="M1 1" />', '0 0 32 32')),
    }));

    const { container } = render(<Icon inlineSvg id="gradient-icon-c" />);

    await waitFor(() => expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 32 32'));
  });

  it('falls back to a 0 0 24 24 viewBox when the symbol has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"><defs><symbol id="icon"><path d="M1 1" /></symbol></defs></svg>'),
    }));

    const { container } = render(<Icon inlineSvg id="gradient-icon-d" />);

    await waitFor(() => expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24'));
  });

  it('fetches an inlined icon only once and reuses the cached markup across instances', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(svgResponse('<path d="M1 1" />')),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container: first } = render(<Icon inlineSvg id="gradient-icon-e" />);
    await waitFor(() => expect(first.querySelector('path')).toBeInTheDocument());

    const { container: second } = render(<Icon inlineSvg id="gradient-icon-e" />);
    await waitFor(() => expect(second.querySelector('path')).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders nothing and does not throw when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const { container } = render(<Icon inlineSvg id="gradient-icon-f" />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});
