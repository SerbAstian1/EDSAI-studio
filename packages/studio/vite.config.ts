import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Two builds from one application.
 *
 * `vite build` is the product. `vite build --mode preview` is the same code
 * with a different entry: one that replays captured API responses instead of
 * calling a server, so the Studio can be looked at on a phone with no backend.
 *
 * Separate entries rather than a runtime flag, so the recording — and the
 * transport that serves it — cannot reach the shipping bundle by accident.
 */
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';

  return {
    plugins: [react()],
    // A preview is published wherever it is published, which may be a subpath.
    // Relative asset URLs are the only ones that survive that.
    base: preview ? './' : '/',
    build: {
      ...(preview ? { outDir: 'dist-preview' } : {}),
      // Reported so the budget script can read real numbers rather than estimates.
      reportCompressedSize: true,
      // The manifest states which chunks the entry reaches statically, which is
      // what "initial route" means. Without it the budget script has to infer it
      // from filenames, and that inference breaks silently when a screen is renamed.
      manifest: true,
      rollupOptions: {
        ...(preview ? { input: 'preview.html' } : {}),
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
  };
});
