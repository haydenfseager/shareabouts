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
| `zip`        | TEXT | nullable, self-reported US ZIP; `NULL` = not collected |
| `ip_hash`    | TEXT | nullable, salted SHA-256 of the submitter's IP — kept only to support IP bans (see Moderation) |
| `hidden_at`  | TEXT | nullable ISO 8601; set once reports cross `REPORT_HIDE_THRESHOLD`, hiding the route from the public list |
| `created_at` | TEXT | ISO 8601                          |

`rate_hits` — one row per accepted `POST`, pruned after the window

| column    | type    | notes                                  |
| --------- | ------- | -------------------------------------- |
| `ip_hash` | TEXT    | salted SHA-256 of the client IP        |
| `hit_at`  | INTEGER | epoch ms                              |

`route_reports` — one row per (route, reporting IP); the pair is the primary key,
so a repeat report from the same IP is a no-op

| column       | type | notes                       |
| ------------ | ---- | --------------------------- |
| `route_id`   | TEXT | references `routes.id`      |
| `ip_hash`    | TEXT | salted SHA-256 of the reporter's IP |
| `created_at` | TEXT | ISO 8601                    |

`banned_ips` — IPs blocked from submitting

| column      | type | notes                              |
| ----------- | ---- | ----------------------------------- |
| `ip_hash`   | TEXT | primary key; salted SHA-256 of the IP |
| `reason`    | TEXT | nullable, set by the admin action   |
| `banned_at` | TEXT | ISO 8601                           |

All four tables are created on first run (`lib/db.ts`), including for existing
databases — the guarded `ALTER TABLE` migrations are non-destructive.

### API

| Method   | Route                    | Body / auth                            | Response                              |
| -------- | ------------------------ | ------------------------------------- | ------------------------------------- |
| `GET`    | `/api/routes`            | –                                     | `{ routes, count }` (hidden routes excluded) |
| `GET`    | `/api/routes?all=1`      | `Authorization: Bearer <ADMIN_TOKEN>` | `{ routes, count }` — includes hidden routes + each one's `reportCount`/`hidden` |
| `POST`   | `/api/routes`            | `{ geometry: [[lat,lng],…], reason?, zip? }` | `201 { route }` · `403/422/400` · `429`  |
| `POST`   | `/api/routes/:id/report` | –                                     | `200 { reportCount, hidden }` · `403` (reporter IP banned) · `404` |
| `POST`   | `/api/routes/:id/ban`    | `Authorization: Bearer <ADMIN_TOKEN>`, optional `{ reason? }` | bans the route's submitter `ip_hash` and deletes it — `200 { banned: true, deleted }` · `400/401/404/503` |
| `POST`   | `/api/routes/:id/unhide` | `Authorization: Bearer <ADMIN_TOKEN>` | clears `hidden_at` **and** the route's `route_reports` — `200 { unhidden }` · `401/404/503` |
| `POST`   | `/api/routes/:id/ban-reporters` | `Authorization: Bearer <ADMIN_TOKEN>`, optional `{ reason? }` | bans every distinct `ip_hash` that reported the route, clears its `route_reports`, and unhides it — `200 { bannedCount, unhidden }` · `401/404/503` |
| `DELETE` | `/api/routes/:id`        | `Authorization: Bearer <ADMIN_TOKEN>` | `200 { deleted }` · `401/404/503`    |

`POST /api/routes` validation (`lib/validate.ts`): 2–200 points, total length
30 m – 25 km, reason trimmed to 280 chars and checked against a profanity/slur
filter (`lib/moderation.ts`, the [`bad-words`][bad-words] package), optional
`zip` matching `\d{5}(-\d{4})?` (blank → `NULL`), and **the entire route inside
the City of Boston** — every vertex and every point along each segment. Each IP
may submit **5 routes per minute** (`lib/rate-limit.ts`); over that returns `429`
with `Retry-After`. A banned IP gets `403` before any of the above run — this
check also runs on `POST /api/routes/:id/report`, so a banned IP can't report
routes either, only submit them.

[bad-words]: https://www.npmjs.com/package/bad-words

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

### Traffic-stress overlay

An optional overlay (sidebar toggle) colors every Boston street by its **Bicycle
Level of Traffic Stress** — LTS 1 (calm enough for most riders) through LTS 4
(heavy, fast traffic); a small number of segments are unscored. It lets you see
how the corridors people ask for line up with the streets that already feel safe.

The data is the City of Boston's ["Bicycle Level of Traffic Stress 2023"][blts]
ArcGIS layer (Boston Transportation Department & Toole Design), replacing the
earlier third-party dataset. `npm run stress` (`scripts/fetch-stress-network.mjs`)
paginates that feature service, keeps only `{ lts, name }` per segment, simplifies
the geometry, and writes `public/stress/boston-blts-2023.geojson` (~19.7k
LineStrings, ~3 MB). That file is committed and lazy-loaded in the browser only
the first time the overlay is switched on; the layer itself is left unmounted
below zoom 12, where individual streets aren't legible. Colors, labels and map
attribution all come from `lib/stress-network.ts` and match boston.gov/blts.

[blts]: https://www.boston.gov/blts

## Project layout

```
app/
  page.tsx                        map shell
  admin/page.tsx                  token-gated moderation UI
  api/routes/route.ts             GET (+ ?all=1 admin) + POST
  api/routes/[id]/route.ts        DELETE (admin)
  api/routes/[id]/report/route.ts POST — flag a route
  api/routes/[id]/ban/route.ts    POST — ban submitter + delete (admin)
  api/routes/[id]/unhide/route.ts POST — clear a report-hide (admin)
  api/routes/[id]/ban-reporters/route.ts POST — ban reporters + restore (admin)
components/
  MapClient.tsx            ssr:false dynamic wrapper
  BikeMap.tsx              map, heat layer, stress overlay, draw tool, report button
  Sidebar.tsx              intro, count, rankings, overlay toggle, recent reasons
lib/
  geo.ts                   Boston config, haversine, sampleLine
  boston-boundary.ts       city-limits polygon + point-in-polygon helpers
  stress-network.ts        BLTS overlay metadata: color ramp, labels, attribution
  db.ts                    libSQL client + queries + schema
  rate-limit.ts            per-IP fixed window + hashIp()
  moderation.ts            comment content filter (bad-words)
  admin.ts                 ADMIN_TOKEN check
  validate.ts              POST body validation
  types.ts                 shared BikeRoute / AdminBikeRoute types
scripts/
  seed.mjs                 example data (local file or remote Turso)
  fetch-boundary.mjs       regenerates lib/boston-boundary.ts from OSM
  fetch-stress-network.mjs vendors the Boston BLTS 2023 layer into public/stress/
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

Four layers, in order of when they kick in:

1. **A content filter** on the comment field (`lib/moderation.ts`, the
   [`bad-words`][bad-words] package) rejects obviously abusive text server-side,
   before it's ever stored.
2. **Reporting** — anyone can flag a route from its map popup ("Report this
   route"). A route auto-hides from the public map (`GET /api/routes`) once it
   has `REPORT_HIDE_THRESHOLD` (3) reports from distinct IPs, but stays fully
   visible in `/admin` for review.
3. **`/admin`** — paste the `ADMIN_TOKEN` (kept only in that tab's session
   storage) and Reload to see everything, including hidden/reported routes and
   their report counts. From there:
   - **Delete** — remove a route.
   - **Ban & Delete** — block the route's *submitter* (by hashed IP) from
     submitting again, and remove the route.
   - **Unhide** — for a route hidden by genuine abuse where the reporters did
     nothing wrong: clears `hidden_at` and the route's `route_reports`, so it
     doesn't immediately re-hide itself.
   - **Ban reporters & restore** — for a route hidden by a *coordinated*
     report campaign against a legitimate route: bans every distinct IP that
     reported it (so they can't submit *or* report again), clears the
     reports, and restores the route. Reporter IPs are hashed the same way
     submitter IPs are (see Privacy below) — they were already being
     recorded for dedupe, this just makes them actionable.
4. **IP bans** — `POST /api/routes` and `POST /api/routes/:id/report` both
   check `banned_ips` before anything else and return `403` for a banned IP.
   There's currently no UI to reverse a ban (a small "banned IPs" admin view
   would be a natural follow-up); until then that's a direct database edit
   (`DELETE FROM banned_ips WHERE ip_hash = ?`).

From the shell:

```bash
curl -X DELETE https://your-app/api/routes/<id> -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X POST https://your-app/api/routes/<id>/ban -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X POST https://your-app/api/routes/<id>/unhide -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X POST https://your-app/api/routes/<id>/ban-reporters -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Notes / limitations

- Rate-limit state lives in `rate_hits`, so it holds across serverless instances,
  but the limit is coarse (per IP, shared by everyone behind a NAT). Add a
  captcha (Turnstile/hCaptcha) if scripted/bulk abuse becomes a problem — IP
  bans and the content filter cover manual abuse, not automated submission.
- **Privacy:** every route stores a salted SHA-256 hash of the *submitter's*
  IP (`routes.ip_hash`, never the raw IP), specifically so a bad submission can
  be traced back and its network banned from submitting again. The Report
  button similarly hashes the *reporter's* IP (`route_reports.ip_hash`) —
  originally just to dedupe repeat reports from one IP, now also usable via
  **Ban reporters & restore** to stop a handful of people from conspiring to
  report-bomb a legitimate route into hiding. Both are a deliberate exception
  to "fully anonymous": nothing else about a submitter or reporter is
  recorded, neither hash can be reversed to an IP, and neither is ever
  returned by any public (non-admin) API response — see Moderation above.
- No login for contributors by design — submissions are anonymous and public.
- Back up the database (Turso has snapshots; for the local file, copy `data/routes.db`).
- Basemap © OpenStreetMap contributors, tiles © Esri.
