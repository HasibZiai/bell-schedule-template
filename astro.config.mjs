// @ts-check
import { defineConfig, envField } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // The site uses no images, so skip the Cloudflare Images binding.
  // To host elsewhere, swap this for another Astro adapter (see README → "Other hosting platforms").
  adapter: cloudflare({ imageService: 'passthrough' }),
  env: {
    schema: {
      // Time zone for schools whose sheet doesn't set one. On Cloudflare it's set in wrangler.jsonc.
      DEFAULT_TZ: envField.string({ context: 'server', access: 'public', default: 'America/Los_Angeles' }),
    },
  },
});