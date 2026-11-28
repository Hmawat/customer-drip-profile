# Customer Drip Profile

Single-page app for baristas: pick a bean, set the drip recipe, save, and hand the customer a QR code that opens their coffee profile.

- `public/index.html` – the whole app (no build step).
- Optional `drip-data.json` – farm/origin photos exported from Admin Settings, placed in `public/`.

Runs on Cloudflare Workers (`wrangler.jsonc`): static files from `public/`, and `src/worker.js` for `/api/*`. No build step.

## Shared data

Coffees, folders, photos, saved recipes and settings are stored in Cloudflare D1 (database `customer-drip-profile`, tables `drip_items` / `drip_config`, created automatically on first request). The page reaches them only through `POST /api/rpc/<name>`: `drip_pull`, `drip_push`, `drip_photo`, `drip_snap`, `drip_set_code`. Every barista device connects once with the shop code (or a `#join=<code>` link from Admin Settings > Devices). Each device keeps a local copy for offline use; items sync one by one, and deletes are soft.

Live updates: after saving, a device sends `changed` on the WebSocket `/api/rt` (a Durable Object per shop), and the other devices fetch at once; a 20-second poll is the fallback.

`POST /api/import` loads rows exported from the old Supabase database (`{code, rows}`); it sets the shop code when none is stored yet, otherwise it needs the current code.

## Image library

Admins can tap **Choose from library** next to Upload on the coffee label and on farm or origin photos. The grid shows photos already uploaded for that branch only. Native Onsen Hotel and Fundamental never share a library.

Photos are stored in a new D1 table, `drip_image_library`, with a `branch` column (`native` or `fundamental`). Every library request reads and writes only the branch in the URL. The table is created by the Worker itself (`CREATE TABLE IF NOT EXISTS`) the first time the new code handles a request. Merging to `main` deploys the Worker (`npx wrangler deploy` via Cloudflare Workers Builds). No separate database command is required, and existing coffee, recipe, and photo rows are left as they are.

The first time an admin opens the library for a branch, photos already linked to that branch's coffees (and photos kept on its saved recipes) are copied into the library. A new upload is added to that same branch's library when it is saved. Opening the library again does not copy them a second time.

## Staff accounts and rollback

Staff sign in at the main URL. Open `/?account=1` to use an account on a device that already remembers its shop code. The owner signs in as `admin`. Only the SHA-256 verifier of the generated owner password belongs in the Worker variable `ACCOUNT_OWNER_PASSWORD_HASH`.

In **Users**, assign each account its branch permissions and share the one-time setup link with that person. Choose the same display name as the existing barista to retain attribution on older recipes. After both teams can sign in, select **Require staff accounts**. **Restore shop-code access** restores the old login with the existing shop codes.

For a full application rollback, redeploy the tree at [rollback-before-user-accounts](https://github.com/Hmawat/customer-drip-profile/tree/rollback-before-user-accounts) using the same D1 binding. Revert the account release in GitHub to keep future builds aligned with the rollback. The update adds account tables and can seed empty Fundamental inventory. A code rollback uses the current database and retains current recipes.

Run `node --test dev/branches.test.mjs` to check access and the legacy API. After editing inline scripts, run `node dev/update-csp.mjs` and verify with `node dev/update-csp.mjs --check`.
