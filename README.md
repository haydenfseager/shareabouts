# Boston Bike Lane Priorities

A map-based public-input webapp, inspired by the [Shareabouts](https://github.com/openplans/shareabouts)
project. Instead of dropping a pin, contributors **draw a route** along the streets where they most
want a protected bike lane. Every submission is sampled into points and added to a shared **heatmap**,
so the corridors the whole city keeps asking for glow hottest.

- Anonymous — no accounts, no login.
- Routes must lie entirely within the City of Boston municipal limits.
- Optional one-line "reason" per route, shown in the sidebar.

## Stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Framework  | Next.js 16 (App Router) + React 19 + TypeScript              |
| Styling    | Tailwind CSS v4                                              |
| Map        | Leaflet + react-leaflet, Esri "Light Gray" basemap (no key) |
| Heatmap    | leaflet.heat, fed points sampled every 25 m along each route |
| Storage    | libSQL (`@libsql/client`) — a local SQLite file in dev, [Turso] in production |

[Turso]: https://turso.tech

## Getting started

```bash
npm install
cp .env.example .env.local   # optional; defaults are fine for local dev
npm run seed                 # loads ~16 example Boston routes
npm run dev                  # http://localhost:3000
```

With no env vars set, the app reads and writes a SQLite file at `data/routes.db`.
`npm run seed` is safe to re-run — it clears the `routes` table and reloads the
examples. To start from nothing, delete `data/routes.db`.

Set `ADMIN_TOKEN` in `.env.local` to use the `/admin` moderation page locally.

## How it works

### Data model

Two tables, created on first run (`lib/db.ts`):

`routes`

| column       | type | notes                              |
| ------------ | ---- | ---------------------------------- |
| `id`         | TEXT | UUID                              |
| `geometry`   | TEXT | JSON `[[lat, lng], …]`, ≥ 2 points |
| `reason`     | TEXT | nullable, ≤ 280 chars              |
| `created_at` | TEXT | ISO 8601                          |

`rate_hits` — one row per accepted `POST`, pruned after the window

| column    | type    | notes                                  |
| --------- | ------- | -------------------------------------- |
| `ip_hash` | TEXT    | salted SHA-256 of the client IP        |
| `hit_at`  | INTEGER | epoch ms                              |

### API

| Method   | Route             | Body / auth                            | Response                              |
| -------- | ----------------- | ------------------------------------- | ------------------------------------- |
| `GET`    | `/api/routes`     | –                                     | `{ routes, count }`                   |
| `POST`   | `/api/routes`     | `{ geometry: [[lat,lng],…], reason? }` | `201 { route }` · `422/400` · `429`  |
| `DELETE` | `/api/routes/:id` | `Authorization: Bearer <ADMIN_TOKEN>` | `200 { deleted }` · `401/404/503`    |

`POST` validation (`lib/validate.ts`): 2–200 points, total length 30 m – 25 km,
reason trimmed to 280 chars, and **the entire route inside the City of Boston** —
every vertex and every point along each segment. Each IP may submit **5 routes per
10 minutes** (`lib/rate-limit.ts`); over that returns `429` with `Retry-After`.

### Staying inside Boston

`lib/boston-boundary.ts` holds the Boston municipal boundary as a single closed
`[lat, lng]` ring (OpenStreetMap relation 2315704, generalised — regenerate with
`npm run boundary`). From it:

- `pointInBoston(p)` — ray-casting point-in-polygon test.
- `segmentInsideBoston(a, b)` — `b` plus every ~15 m sample along the segment must
  be inside, so a straight line between two in-city points can't cut a corner
  through a neighbouring town.
- `routeInsideBoston(points)` — every vertex and every segment inside.

The server rejects any route that isn't fully inside. The client uses the same
functions to (a) shade everything outside the boundary while you draw, (b) refuse
a click whose point — or whose segment from the previous point — would leave the
city, and (c) disable **Finish** if the drafted route leaves Boston at all.

### Frontend

- `app/page.tsx` → `components/MapClient.tsx` dynamically imports `components/BikeMap.tsx`
  with `ssr: false` (Leaflet needs `window`).
- `BikeMap.tsx` holds all state: fetches routes, renders the heat layer, and runs the
  draw tool (click to add vertices, **Enter** finish, **Backspace** undo, **Esc** cancel).
- `lib/geo.ts` has the Boston constants plus `sampleLine()`, which walks each polyline
  and emits an evenly spaced point every 25 m. Those points — not the raw vertices —
  are what the heat layer sees, so overlapping routes stack up and long routes don't
  dominate just by having more clicks.

## Project layout

```
app/
  page.tsx                 map shell
  admin/page.tsx           token-gated moderation UI
  api/routes/route.ts      GET + POST
  api/routes/[id]/route.ts DELETE (admin)
components/
  MapClient.tsx            ssr:false dynamic wrapper
  BikeMap.tsx              map, heat layer, draw tool
  Sidebar.tsx              intro, count, recent reasons
lib/
  geo.ts                   Boston config, haversine, sampleLine
  boston-boundary.ts       city-limits polygon + point-in-polygon helpers
  db.ts                    libSQL client + queries + schema
  rate-limit.ts            per-IP fixed window
  admin.ts                 ADMIN_TOKEN check
  validate.ts              POST body validation
  types.ts                 shared BikeRoute type
scripts/
  seed.mjs                 example data (local file or remote Turso)
  fetch-boundary.mjs       regenerates lib/boston-boundary.ts from OSM
```

## Deploying (Vercel + Turso)

Vercel's filesystem is read-only, so production uses a hosted [Turso] database.

1. **Create the database**

   ```bash
   turso db create shareabouts
   turso db show shareabouts --url        # -> TURSO_DATABASE_URL
   turso db tokens create shareabouts     # -> TURSO_AUTH_TOKEN
   ```

2. **Seed it once**

   ```bash
   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run seed
   ```

3. **Deploy** — import the repo in Vercel and set environment variables:

   | Variable             | Required | Purpose                                            |
   | -------------------- | -------- | ------------------------------------------------- |
   | `TURSO_DATABASE_URL` | yes      | Turso database URL                                |
   | `TURSO_AUTH_TOKEN`   | yes      | Turso auth token                                  |
   | `ADMIN_TOKEN`        | yes\*    | enables `DELETE` + `/admin`; a long random string |
   | `RATE_LIMIT_SALT`    | no       | salt for hashed IPs (defaults to a constant)      |

   \* Without `ADMIN_TOKEN`, deletion is disabled and `/admin` can only view.

The `routes` and `rate_hits` tables are created automatically on the first request.

### Moderation

Visit `/admin`, paste the `ADMIN_TOKEN` (kept only in that tab's session storage),
and delete bad entries. Same thing from the shell:

```bash
curl -X DELETE https://your-app/api/routes/<id> -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Notes / limitations

- Rate-limit state lives in `rate_hits`, so it holds across serverless instances,
  but the limit is coarse (per IP, shared by everyone behind a NAT). Add a
  captcha (Turnstile/hCaptcha) if it gets abused.
- No login for contributors by design — submissions are anonymous and public.
- Back up the database (Turso has snapshots; for the local file, copy `data/routes.db`).
- Basemap © OpenStreetMap contributors, tiles © Esri.
