import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` -> emits relative asset URLs so the same `dist/` runs from
// GitHub Pages, an S3/CloudFront subpath, OR embedded as an Experience
// Builder iframe widget without rewriting paths.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
});
