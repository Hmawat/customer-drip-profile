# Customer Drip Profile

Single-page app for baristas: pick a bean, set the drip recipe, save, and hand the customer a QR code that opens their coffee profile.

- `public/index.html` – the whole app (no build step).
- Optional `drip-data.json` – farm/origin photos exported from Admin Settings, placed in `public/`.

Runs on Cloudflare Workers (`wrangler.jsonc`): static files from `public/`, and `src/worker.js` for `/api/*`. No build step.

## Shared data

Coffees, folders, photos, saved recipes and settings are stored in Cloudflare D1 (database `customer-drip-profile`, tables `drip_items` / `drip_config`, created automatically on first request). The page reaches them only through `POST /api/rpc/<name>`: `drip_pull`, `drip_push`, `drip_photo`, `drip_snap`, `drip_set_code`. Every barista device connects once with the shop code (or a `#join=<code>` link from Admin Settings > Devices). Each device keeps a local copy for offline use; items sync one by one, and deletes are soft.

Live updates: after saving, a device sends `changed` on the WebSocket `/api/rt` (a Durable Object per shop), and the other devices fetch at once; a 20-second poll is the fallback.

`POST /api/import` loads rows exported from the old Supabase database (`{code, rows}`); it sets the shop code when none is stored yet, otherwise it needs the current code.
