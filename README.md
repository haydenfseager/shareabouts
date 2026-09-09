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
| Storage    | SQLite via Node's built-in `node:sqlite` (no native build)   |

## Getting started

```bash
npm install
npm run seed      # loads ~16 example Boston routes so the heatmap isn't empty
npm run dev       # http://localhost:3000
```

`npm run seed` is safe to re-run — it clears the `routes` table and reloads the examples.
To start from nothing instead, delete `data/routes.db`.

## How it works

### Data model

One table, `routes`, in `data/routes.db` (git-ignored, created on first run):

| column       | type | notes                              |
| ------------ | ---- | ---------------------------------- |
| `id`         | TEXT | UUID                              |
| `geometry`   | TEXT | JSON `[[lat, lng], …]`, ≥ 2 points |
| `reason`     | TEXT | nullable, ≤ 280 chars              |
| `created_at` | TEXT | ISO 8601                          |

### API

| Method | Route         | Body                                  | Response                        |
| ------ | ------------- | ------------------------------------- | ------------------------------- |
| `GET`  | `/api/routes` | –                                     | `{ routes: Route[], count }`    |
| `POST` | `/api/routes` | `{ geometry: [[lat,lng],…], reason? }` | `201 { route }` / `422 { error }` |

`POST` validation (`lib/validate.ts`): 2–200 points, total length 30 m – 25 km,
reason trimmed to 280 chars, and **the entire route inside the City of Boston** —
every vertex and every point along each segment.

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
  page.tsx                 shell
  layout.tsx               metadata, fonts
  api/routes/route.ts      GET + POST
components/
  MapClient.tsx            ssr:false dynamic wrapper
  BikeMap.tsx              map, heat layer, draw tool
  Sidebar.tsx              intro, count, recent reasons
lib/
  geo.ts                   Boston config, haversine, sampleLine
  boston-boundary.ts       city-limits polygon + point-in-polygon helpers
  db.ts                    node:sqlite connection + queries
  validate.ts              POST body validation
  types.ts                 shared BikeRoute type
scripts/
  seed.mjs                 example data
  fetch-boundary.mjs       regenerates lib/boston-boundary.ts from OSM
```

## Notes / limitations

- The SQLite file is local to the machine running the server. On a read-only host
  (e.g. Vercel) you would swap `lib/db.ts` for a hosted database — the rest is unchanged.
- No moderation or rate limiting; every valid `POST` is published immediately. Fine for
  a demo, not for an open production deployment.
- Basemap © OpenStreetMap contributors, tiles © Esri.
