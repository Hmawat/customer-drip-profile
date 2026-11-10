# Notes for Claude: Customer Drip Profile

The owner runs a coffee shop and writes in Thai. Reply in Thai, keep it short, and explain in plain words (not code terms).
All text inside the app is English.

## What it is
A barista tool: pick a green coffee, set a drip recipe, save it, and give the customer a QR code that opens their coffee profile.
Live site: https://customer-drip-profile.cbm-c52.workers.dev/ (this repo is public: never commit codes, PINs or keys).

## How it is built
- `public/index.html` is the whole app (vanilla JS, no build step). Global `D` (also `window.DP`), state `D.S`, `render()`.
- UI text lives in a label list of `['key','English text']` entries, read with `D.T(key)`; admins can edit them in Admin > Text & Labels.
- Look: Apple Store style (#0071e3 blue, #f5f5f7 background, system fonts). Responsive; must work on phones (iOS and Android Chrome).
- `src/worker.js` is the backend on Cloudflare Workers:
  - `POST /api/rpc/<name>`: `drip_pull`, `drip_push`, `drip_photo`, `drip_snap`, `drip_set_code`. Everything except photos/snaps needs the shop code.
  - Data in Cloudflare D1 (`DB` binding, database `customer-drip-profile`): table `drip_items(kind, id, data, deleted, updated_ms)` with kinds bean, folder, photo, snap, setting; and `drip_config` (hash of the shop code). Tables are created on first request.
  - `GET /api/rt?t=<topic>` is a WebSocket hub (Durable Object `Hub`, binding `RT`): a device sends `changed` after saving, others pull at once. 20 s polling is the fallback.
- Client sync: items are synced one by one (`D.items`, `D.build`, `D.pull`, `D.flush`), deletes are soft, a local copy is kept in IndexedDB for offline use.
- Customer QR links: short `#c=<snapId>.<key>` (resolved by `drip_snap`), fallback `#s=<payload>`.
- Barista sign-in: names set by admin, 4-digit personal PINs (stored per barista as `setting|baPin.<name>`). Stock (out of stock) needs the stock PIN; admin has its own PIN.

## Deploying
Push to `main` on GitHub: Cloudflare Workers Builds runs `npx wrangler deploy` (config in `wrangler.jsonc`) and the site updates in about a minute.
The sandbox usually cannot reach workers.dev or Cloudflare directly; check the live site through the browser tools if available.

## Testing before pushing
- Syntax: extract each inline `<script>` from `public/index.html` and run `node --check`; also `node --check src/worker.js`.
- Local server with a D1 stand-in (Node 22 built-in SQLite):
  `node --no-warnings dev/serve.mjs . 8793 /tmp/drip.db` then open http://localhost:8793/#join=<shop code>.
  Load data first with `POST /api/import` `{code, rows:[{k,i,d,x,t}]}` (sets the shop code when none is stored).
- Use Playwright (Python) for UI checks; take screenshots at phone width (about 390–420 px).

## Commits
Author `Hmawat`. End messages with the attribution lines the session provides.
