import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import compression from 'vite-plugin-compression';
import { defineConfig } from 'vitest/config'
import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from '@vitejs/plugin-react'

import layerCssModules from './scripts/postcss-layer-css-modules.js'

const isProduction = process.env.NODE_ENV === 'production';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    visualizer({
      open: true,
      gzipSize: true,
    }),
    compression({ algorithm: 'gzip' }),
    isProduction && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: process.env.SENTRY_RELEASE,
      },
      sourcemaps: {
        assets: "./dist/**",
      },
      debug: true,
    })
  ],
  css: {
    postcss: {
      plugins: [layerCssModules()],
    },
  },
  resolve: {
    alias: {
      '@constants': path.resolve(__dirname, './src/constants'),
      '@components': path.resolve(__dirname, './src/components'),
      '@helpers': path.resolve(__dirname, './src/helpers'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@customTypes': path.resolve(__dirname, './src/types'),
      '@ui-components': path.resolve(__dirname, './src/ui-components'),
      '@services': path.resolve(__dirname, './src/services'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@layouts': path.resolve(__dirname, './src/layouts'),
      '@trial-banners': path.resolve(__dirname, './src/trial-banners'),
      '@lang': path.resolve(__dirname, './lang'),
      '@root': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true, // or '0.0.0.0',
    allowedHosts: ['frontend', 'localhost', 'host.docker.internal'],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}', 'eslint-plugins/**/*.test.js'],
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
