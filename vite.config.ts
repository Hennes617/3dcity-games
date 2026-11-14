import { defineConfig } from 'vite';

export default defineConfig({
  // relative base: the build works from any static host path
  base: './',
  // the game, the page about a full version, and the two legal pages its form links to
  build: { target: 'es2022', chunkSizeWarningLimit: 900, rollupOptions: { input: { main: 'index.html', full: 'full/index.html', impressum: 'impressum/index.html', privacy: 'privacy/index.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as Parameters<typeof defineConfig>[0]);
