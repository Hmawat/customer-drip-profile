# Customer Drip Profile

Single-page app for baristas: pick a bean, set the drip recipe, save, and hand the customer a QR code that opens their coffee profile.

- `public/index.html` – the whole app (no build step).
- Optional `drip-data.json` – farm/origin photos exported from Admin Settings, placed in `public/`.

Deployed to Cloudflare Workers static assets via `wrangler.jsonc` (no build command).
