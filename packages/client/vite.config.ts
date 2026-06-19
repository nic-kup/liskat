import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    // Proxy WebSocket traffic to the game server during development so the
    // client can talk to /ws on the same origin.
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        rewrite: (p) => p.replace(/^\/ws/, ''),
      },
      '/feedback': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/admin': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/stats': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
