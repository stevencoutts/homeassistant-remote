import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    // ponytail: minimal manifest only. Real icons, offline strategy and update flow are phase 5 polish.
    SvelteKitPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Room Remote',
        short_name: 'Room Remote',
        description: 'Per-room touchscreen remote for Home Assistant',
        theme_color: '#0e1116',
        background_color: '#0e1116',
        display: 'standalone',
        orientation: 'any',
        start_url: '/'
      }
    })
  ]
});
