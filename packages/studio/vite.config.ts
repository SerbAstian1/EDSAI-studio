import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // Reported so the budget script can read real numbers rather than estimates.
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // React and the query client are the stable half of the bundle; splitting
        // them keeps a shell change from invalidating them in a browser cache.
        manualChunks: {
          react: ['react', 'react-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:4317' } },
});
