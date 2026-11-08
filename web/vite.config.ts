import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En dev : http://localhost:5173, l'API tourne sur :4011 (npm run dev côté serveur avec PORT=4011)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4011', changeOrigin: false },
      '/ws': { target: 'ws://localhost:4011', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
