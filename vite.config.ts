import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under the repository name.
  base: '/deepseek-peakprice/',
  server: {
    host: true, // bind 0.0.0.0 so the Docker port mapping works
    port: 5173,
    strictPort: true,
  },
});
