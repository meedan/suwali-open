export {};

declare global {
  interface Window {
    CONFIG?: Record<string, string>;
  }
}
