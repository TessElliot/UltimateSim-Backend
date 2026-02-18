# Copy this folder into UltimateSim_Backend repo

Use this **fetching** folder as the new backend for https://github.com/singh-sagar/UltimateSim_Backend/ (Render), with frontend on GoDaddy.

## What to copy

Copy **everything inside** `UltimateSim/fetching/` into the **root** of your `UltimateSim_Backend` repo:

- `Server.cjs` (entry point; Render runs `npm start` → `node Server.cjs`)
- `package.json`
- `create_global_map_tiles.sql`
- `create_saved_maps_table.sql`
- `.gitignore`

So the backend repo root should contain:

```
UltimateSim_Backend/
  Server.cjs
  package.json
  create_global_map_tiles.sql
  create_saved_maps_table.sql
  .gitignore
  node_modules/   (after npm install)
```

## Steps

1. **Clone your backend repo** (if needed):
   ```bash
   git clone https://github.com/singh-sagar/UltimateSim_Backend.git
   cd UltimateSim_Backend
   ```

2. **Replace its contents** with the contents of this `fetching` folder:
   - Delete or move aside any old files in the backend repo root (e.g. old server file, old package.json).
   - Copy `Server.cjs`, `package.json`, `create_global_map_tiles.sql`, `create_saved_maps_table.sql`, `.gitignore` from `UltimateSim/fetching/` into the backend repo root.

3. **Install and run locally (optional)**:
   ```bash
   npm install
   npm start
   ```
   Server runs on port 8800 (or `PORT` if set). `GET /` should return `{"ok":true,"service":"UltimateSim API"}`.

4. **Push to GitHub** so Render redeploys:
   ```bash
   git add .
   git commit -m "Replace with UltimateSim fetching backend (Server.cjs, env, CORS)"
   git push origin main
   ```

5. **Configure Render**
   - **Build command:** `npm install`
   - **Start command:** `npm start` (uses `Server.cjs`).
   - **Environment variables** (in Render dashboard):
     - `FRONTEND_ORIGIN` = your GoDaddy frontend URL (e.g. `https://yourdomain.com`). Use `*` only for quick dev.
     - For TiDB/MySQL: `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_PORT`.
   - `PORT` is set by Render; no need to set it.

6. **Database (TiDB/MySQL)**  
   Create DB and tables using the two SQL files (e.g. in TiDB Cloud or your MySQL). Column names in `saved_maps` must match: `gridWidth`, `gridHeight`, `tiles`, `landUseInfo`.

## Changes made for backend-only + Render

- **No static files** — frontend is on GoDaddy; `GET /` returns a small JSON health check.
- **CORS** — `FRONTEND_ORIGIN` allows your GoDaddy origin to call the API.
- **Port** — `process.env.PORT || 8800` for Render.
- **DB config** — `MYSQL_*` env vars for TiDB/MySQL on Render.
- **saved_maps** — SQL table uses `gridWidth`, `gridHeight`, `tiles`, `landUseInfo` to match `Server.cjs`.
