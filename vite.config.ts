import { defineConfig } from 'vite';

export default defineConfig({
  // relative base: the build works from any static host path
  base: './',
  // two pages: the game, and the page a sign-in link opens
  build: { target: 'es2022', chunkSizeWarningLimit: 900, rollupOptions: { input: { main: 'index.html', account: 'account/index.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as Parameters<typeof defineConfig>[0]);
