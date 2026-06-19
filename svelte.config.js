import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // SPA: prerender nothing, serve a single index.html fallback. Phase 1 is fully client-side.
    adapter: adapter({ fallback: 'index.html' })
  }
};
