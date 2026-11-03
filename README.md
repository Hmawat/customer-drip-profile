# Customer Drip Profile

Single-page app for baristas: pick a bean, set the drip recipe, save, and hand the customer a QR code that opens their coffee profile.

- `public/index.html` – the whole app (no build step).
- Optional `drip-data.json` – farm/origin photos exported from Admin Settings, placed in `public/`.

Deployed to Cloudflare Workers static assets via `wrangler.jsonc` (no build command).

## Shared data

Coffees, folders, photos, saved recipes and settings are stored in Supabase (project `aroma-lab`, tables `drip_items` / `drip_config`) and reached only through the `drip_pull`, `drip_push` and `drip_photo` functions. Every barista device connects once with the shop code (or a `#join=<code>` link from Admin Settings > Devices). Each device keeps a local copy for offline use; items sync one by one, and deletes are soft.
