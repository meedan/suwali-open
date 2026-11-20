const Config = {
  get: (key: string, fallback: string): string => {
    // In staging/production, config is injected by docker-entrypoint.sh
    if (typeof window !== 'undefined' && window.CONFIG) {
      return window.CONFIG[key] || fallback;
    } else {
      return import.meta.env[key] || fallback;
    }
  },
};
export default Config;
