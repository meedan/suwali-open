// The URL <Icon> draws from; any other spelling, even without the empty query, is a separate cache entry
export const iconUrl = (id: string) => `/assets/icons/${id}.svg?`;

// Loads an icon into the browser cache, so it can still be drawn after the connection drops
export const prefetchIcon = (id: string) => {
  new Image().src = iconUrl(id);
};
