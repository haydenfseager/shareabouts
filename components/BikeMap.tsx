"use client";

import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AttributionControl,
  CircleMarker,
  GeoJSON,
  type GeoJSONProps,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";

import {
  BOSTON_BOUNDS,
  BOSTON_CENTER,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  haversine,
  lineLength,
  sampleLine,
  type LatLng,
} from "@/lib/geo";
import {
  BOSTON_BOUNDARY,
  pointInBoston,
  routeInsideBoston,
  segmentInsideBoston,
} from "@/lib/boston-boundary";
import { BOSTON_NEIGHBORHOODS, neighborhoodAt } from "@/lib/boston-neighborhoods";
import { MAX_REASON_LENGTH } from "@/lib/validate";
import type { BikeRoute, HotNeighborhood, HotRoute } from "@/lib/types";
import {
  LTS_COLOR,
  LTS_LABEL,
  STRESS_ATTRIBUTION,
  STRESS_DATASET,
  ltsColor,
  type StressFeatureProps,
} from "@/lib/stress-network";
import { Sidebar } from "./Sidebar";

/** The vendored stress GeoJSON: a FeatureCollection of LTS-scored street segments. */
type StressCollection = FeatureCollection<LineString, StressFeatureProps>;

/** Every Level-of-Traffic-Stress bucket the overlay can filter by (0 = off-street). */
const STRESS_LEVELS = [0, 1, 2, 3, 4] as const;

// react-leaflet's GeoJSON props omit `renderer`, but Leaflet forwards the option
// straight onto the layer and every child polyline it builds — that's how ~2.5k
// segments share one <canvas> instead of spawning 2.5k SVG nodes.
const CanvasGeoJSON = GeoJSON as ComponentType<GeoJSONProps & { renderer?: L.Renderer }>;

/** A ring spanning the whole map; with BOSTON_BOUNDARY as a hole it shades everything outside the city. */
const WORLD_RING: LatLng[] = [
  [-85, -179.9],
  [-85, 179.9],
  [85, 179.9],
  [85, -179.9],
];

const HEAT_OPTIONS: L.HeatMapOptions = {
  minOpacity: 0.3,
  max: 3,
  maxZoom: 17,
  gradient: {
    0.2: "#1d4ed8",
    0.4: "#0891b2",
    0.6: "#16a34a",
    0.75: "#eab308",
    0.9: "#f97316",
    1.0: "#dc2626",
  },
};

// The heat radius/blur are pixel values, so a fixed size smears into one blob
// when the map is zoomed out. These are calibrated for HEAT_BASE_ZOOM and shrink
// as the map zooms out, keeping corridors legible at a wide view.
const HEAT_BASE_ZOOM = 13;
const HEAT_BASE_RADIUS = 18;
const HEAT_BASE_BLUR = 22;

function heatSizeForZoom(zoom: number): { radius: number; blur: number } {
  const factor = zoom >= HEAT_BASE_ZOOM ? 1 : 2 ** ((zoom - HEAT_BASE_ZOOM) * 0.6);
  return {
    radius: Math.max(6, Math.round(HEAT_BASE_RADIUS * factor)),
    blur: Math.max(8, Math.round(HEAT_BASE_BLUR * factor)),
  };
}

// "Routes near here": a background tap in view mode collects every route whose
// polyline passes within NEARBY_RADIUS_M of the tapped point. Distance is the
// min haversine to a ~NEARBY_SAMPLE_M-spaced sampling of the line — close enough
// at this threshold, and cheap for the whole (client-side) route set.
const NEARBY_RADIUS_M = 200;
const NEARBY_SAMPLE_M = 20;

/** Shortest distance (m) from `point` to a sampled `geometry` polyline. */
function distanceToRoute(point: LatLng, geometry: LatLng[]): number {
  let min = Infinity;
  for (const s of sampleLine(geometry, NEARBY_SAMPLE_M)) {
    const d = haversine(point, s);
    if (d < min) min = d;
  }
  return min;
}

// "Hottest" ranking — all client-side, over the loaded route set:
//  - Routes: hash every 25 m sample into ~40 m grid cells; a route's score is the
//    MEAN count of *other* routes sharing its cell (or an adjacent one) along its
//    length, so a long route isn't rewarded for length alone. A greedy pass then
//    collapses the same corridor drawn many times into a single row.
//  - Neighborhoods: tally which neighborhood every sample falls in.
const HOT_CELL = 0.0005; // ~40 m of lat/lng in Boston
const HOT_DEDUPE_RADIUS_M = 50;
const HOT_DEDUPE_SHARE = 0.6;
const HOT_LIST_MAX = 5;
const HOT_MIN_ROUTES = 3;

type Mode = "view" | "draw";

type HeatPoint = [number, number, number];

/** leaflet.heat keeps a private rAF handle for its debounced redraw. */
type HeatLayerInternal = L.HeatLayer & { _frame?: number | null };

/** Renders and keeps a Leaflet.heat layer in sync with the sampled route points. */
function HeatLayer({ points }: { points: LatLng[] }) {
  const map = useMap();
  const layerRef = useRef<HeatLayerInternal | null>(null);
  const dataRef = useRef<HeatPoint[]>([]);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    // leaflet.heat draws to a canvas sized from the map. If it is added before
    // the container has been laid out, simpleheat calls getImageData on a
    // 0-width canvas and throws. Wait for a ready, non-zero-size map, and let
    // two animation frames pass so layout + paint have settled.
    const tryAdd = () => {
      if (cancelled || layerRef.current) return;
      const size = map.getSize();
      if (size.x === 0 || size.y === 0) {
        raf = requestAnimationFrame(tryAdd);
        return;
      }
      const layer = L.heatLayer(dataRef.current, {
        ...HEAT_OPTIONS,
        ...heatSizeForZoom(map.getZoom()),
      }) as HeatLayerInternal;
      layer.addTo(map);
      layerRef.current = layer;
    };

    map.whenReady(() => {
      if (cancelled) return;
      map.invalidateSize();
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(tryAdd);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      const layer = layerRef.current;
      if (layer) {
        // Cancel any pending internal redraw so it can't run against a
        // detached canvas after removal.
        if (layer._frame) cancelAnimationFrame(layer._frame);
        layer._frame = null;
        layer.remove();
      }
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    dataRef.current = points.map(([lat, lng]) => [lat, lng, 1] as HeatPoint);
    if (layerRef.current && map.getSize().x > 0) {
      layerRef.current.setLatLngs(dataRef.current);
    }
  }, [points, map]);

  // Rescale the heat radius/blur to the current zoom (setOptions redraws).
  useEffect(() => {
    const applySize = () => layerRef.current?.setOptions(heatSizeForZoom(map.getZoom()));
    map.on("zoomend", applySize);
    return () => {
      map.off("zoomend", applySize);
    };
  }, [map]);

  return null;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** LTS colour ramp for a stress segment; grey when the score is unknown. */
function stressLineStyle(feature?: Feature<Geometry>): L.PathOptions {
  const props = feature?.properties as StressFeatureProps | undefined;
  return { color: ltsColor(props?.lts ?? null), weight: 3, opacity: 0.75 };
}

/** Popup with the street name, its LTS label and a link to the OSM way. */
function bindStressPopup(feature: Feature<Geometry>, layer: L.Layer): void {
  const props = feature.properties as StressFeatureProps | null;
  const lts = props?.lts ?? null;
  const ltsText = lts == null ? "Stress rating unknown" : (LTS_LABEL[lts] ?? `LTS ${lts}`);
  const name = props?.name ? escapeHtml(props.name) : "Unnamed segment";
  const osmLink =
    props?.osmId != null
      ? `<p><a href="https://www.openstreetmap.org/way/${props.osmId}" target="_blank" rel="noreferrer">View on OpenStreetMap</a></p>`
      : "";
  layer.bindPopup(
    `<p class="font-semibold text-slate-800">${name}</p><p class="text-slate-600">${ltsText}</p>${osmLink}`,
  );
}

/**
 * The traffic-stress network, drawn to a shared canvas in a dedicated low-z pane
 * so the lines sit under the heatmap and the drawn/highlight layers but over the
 * base tiles. Mounted only while the overlay is on; the call site keys it on the
 * visible-levels set so a stress-level toggle rebuilds the (filtered) layer.
 */
function StressLayer({
  data,
  renderer,
  visibleLevels,
}: {
  data: StressCollection;
  renderer: L.Renderer;
  visibleLevels: ReadonlySet<number>;
}) {
  return (
    <CanvasGeoJSON
      data={data}
      pane="stress"
      renderer={renderer}
      filter={(feature) => {
        const lts = (feature.properties as StressFeatureProps | null)?.lts;
        return lts == null || visibleLevels.has(lts);
      }}
      style={stressLineStyle}
      onEachFeature={bindStressPopup}
      attribution={STRESS_ATTRIBUTION}
    />
  );
}

/** True below Tailwind's `md` breakpoint (< 768px). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

/** Tell Leaflet to re-measure when its container is resized by a layout change. */
function InvalidateOnResize({ dep }: { dep: unknown }) {
  const map = useMap();
  useEffect(() => {
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [dep, map]);
  return null;
}

/** Turns map clicks into route vertices while in draw mode (desktop only). */
function DrawController({
  active,
  tapToAdd,
  onAddPoint,
  onHover,
}: {
  active: boolean;
  tapToAdd: boolean;
  onAddPoint: (p: LatLng) => void;
  onHover: (p: LatLng | null) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (active) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    return () => {
      map.doubleClickZoom.enable();
    };
  }, [active, map]);

  useMapEvents({
    click(e) {
      if (active && tapToAdd) onAddPoint([e.latlng.lat, e.latlng.lng]);
    },
    mousemove(e) {
      if (active) onHover([e.latlng.lat, e.latlng.lng]);
    },
    mouseout() {
      onHover(null);
    },
  });

  return null;
}

/** Fixed reticle marking the map centre — the point the mobile "Add point" button uses. */
function Crosshair() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-[900] -translate-x-1/2 -translate-y-1/2">
      <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
        <g fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round">
          <circle cx="23" cy="23" r="10" />
          <line x1="23" y1="2" x2="23" y2="9" />
          <line x1="23" y1="37" x2="23" y2="44" />
          <line x1="2" y1="23" x2="9" y2="23" />
          <line x1="37" y1="23" x2="44" y2="23" />
        </g>
        <g fill="none" stroke="#0e7490" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="23" cy="23" r="10" />
          <line x1="23" y1="2" x2="23" y2="9" />
          <line x1="23" y1="37" x2="23" y2="44" />
          <line x1="2" y1="23" x2="9" y2="23" />
          <line x1="37" y1="23" x2="44" y2="23" />
        </g>
        <circle cx="23" cy="23" r="2.5" fill="#0e7490" stroke="#ffffff" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/** Dashed line from the last placed point to the current map centre (mobile crosshair mode). */
function CrosshairPreview({ active, from }: { active: boolean; from: LatLng | null }) {
  const map = useMap();
  const [center, setCenter] = useState<LatLng>(() => {
    const c = map.getCenter();
    return [c.lat, c.lng];
  });

  useMapEvents({
    move() {
      const c = map.getCenter();
      setCenter([c.lat, c.lng]);
    },
  });

  if (!active || !from) return null;
  return (
    <Polyline
      positions={[from, center]}
      pathOptions={{ color: "#0e7490", weight: 3, dashArray: "6 8", opacity: 0.7 }}
    />
  );
}

/**
 * View-mode taps on the map background. The highlighted route casing/line is
 * `interactive={false}`, so a tap on it lands here too — every view-mode click
 * opens (or toggles shut) the "routes near here" panel at that point.
 */
function ViewClickController({
  active,
  onBackgroundClick,
}: {
  active: boolean;
  onBackgroundClick: (p: LatLng) => void;
}) {
  useMapEvents({
    click(e) {
      if (active) onBackgroundClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

export default function BikeMap() {
  const [routes, setRoutes] = useState<BikeRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);

  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [hover, setHover] = useState<LatLng | null>(null);
  const [finished, setFinished] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outsideHint, setOutsideHint] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  // Ranked-neighborhood highlight. Mutually exclusive with a route highlight and
  // with the "routes near here" panel.
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string | null>(null);
  // The point of the last view-mode background tap; non-null while the
  // "routes near here" panel is open.
  const [nearbyQuery, setNearbyQuery] = useState<LatLng | null>(null);
  // Traffic-stress overlay: whether the network is showing, plus the lazily
  // fetched FeatureCollection and any fetch error (both kept once resolved).
  const [stressOn, setStressOn] = useState(false);
  const [stressData, setStressData] = useState<StressCollection | null>(null);
  const [stressError, setStressError] = useState<string | null>(null);
  // Which LTS levels to draw; all on by default.
  const [stressLevels, setStressLevels] = useState<ReadonlySet<number>>(
    () => new Set(STRESS_LEVELS),
  );
  const isMobile = useIsMobile();

  const stressLoading = stressOn && stressData == null && stressError == null;
  const stressLevelKey = STRESS_LEVELS.filter((lts) => stressLevels.has(lts)).join("-");

  // One shared canvas for the whole stress network (2.5k polylines as SVG is slow).
  // `tolerance` widens the click target so the 3px lines are easy to tap.
  const stressRenderer = useMemo(
    () => L.canvas({ padding: 0.5, tolerance: 4, pane: "stress" }),
    [],
  );

  // A low-z pane so the stress lines render above the base tiles but below the
  // heatmap and the drawn-route / highlight layers (all in the overlay pane).
  useEffect(() => {
    if (!map || map.getPane("stress")) return;
    map.createPane("stress").style.zIndex = "250";
  }, [map]);

  // Leaflet auto-adds the shared canvas renderer to the map with the first path;
  // pull it back out once the overlay is fully off so the "stress" pane is empty.
  useEffect(() => {
    if (stressOn || !map) return;
    if (map.hasLayer(stressRenderer)) map.removeLayer(stressRenderer);
  }, [stressOn, map, stressRenderer]);

  // Fetch the network the first time it's switched on; keep it once loaded.
  useEffect(() => {
    if (!stressOn || stressData || stressError) return;
    let cancelled = false;
    fetch(STRESS_DATASET.path)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<StressCollection>;
      })
      .then((data) => {
        if (!cancelled) setStressData(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setStressError(
            err instanceof Error ? err.message : "Could not load the stress network.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stressOn, stressData, stressError]);

  const toggleStress = useCallback((on: boolean) => {
    setStressOn(on);
    if (on) setStressError(null); // let a previously failed load retry
  }, []);

  const toggleStressLevel = useCallback((lts: number) => {
    setStressLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lts)) next.delete(lts);
      else next.add(lts);
      return next;
    });
  }, []);

  const retryStress = useCallback(() => setStressError(null), []);

  // Clear the "outside Boston" nudge a few seconds after it last fired.
  useEffect(() => {
    if (!outsideHint) return;
    const t = setTimeout(() => setOutsideHint(false), 3500);
    return () => clearTimeout(t);
  }, [outsideHint]);

  const loadRoutes = useCallback(async () => {
    try {
      const res = await fetch("/api/routes", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as { routes: BikeRoute[] };
      setRoutes(data.routes);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load routes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load once on mount; state updates happen after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoutes();
  }, [loadRoutes]);

  const heatPoints = useMemo(
    () => routes.flatMap((r) => sampleLine(r.geometry)),
    [routes],
  );

  // Top corridors by overlap density. For every route, sample it at 25 m, drop
  // each sample into a ~40 m spatial-hash cell, then score the route by the mean
  // number of *other* routes found in each sample's 3x3 cell block. A greedy
  // de-dupe folds "same corridor drawn N times" into one row.
  const hotRoutes = useMemo<HotRoute[]>(() => {
    if (routes.length < HOT_MIN_ROUTES) return [];

    const sampled = routes.map((route) => ({
      route,
      samples: sampleLine(route.geometry, 25),
    }));

    const grid = new Map<string, Set<string>>();
    for (const { route, samples } of sampled) {
      for (const [lat, lng] of samples) {
        const key = `${Math.round(lat / HOT_CELL)}:${Math.round(lng / HOT_CELL)}`;
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = new Set()));
        cell.add(route.id);
      }
    }

    const scored = sampled.map(({ route, samples }) => {
      let sum = 0;
      let peak = 0;
      for (const [lat, lng] of samples) {
        const ci = Math.round(lat / HOT_CELL);
        const cj = Math.round(lng / HOT_CELL);
        const others = new Set<string>();
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const cell = grid.get(`${ci + di}:${cj + dj}`);
            if (!cell) continue;
            for (const id of cell) if (id !== route.id) others.add(id);
          }
        }
        sum += others.size;
        if (others.size > peak) peak = others.size;
      }
      return { route, samples, score: samples.length ? sum / samples.length : 0, peak };
    });
    scored.sort((a, b) => b.score - a.score);

    type Kept = { route: BikeRoute; peak: number; merged: number };
    const kept: Kept[] = [];
    for (const cand of scored) {
      let best: Kept | null = null;
      let bestNear = 0;
      for (const k of kept) {
        let near = 0;
        for (const s of cand.samples) {
          if (distanceToRoute(s, k.route.geometry) <= HOT_DEDUPE_RADIUS_M) near += 1;
        }
        if (near > bestNear) {
          bestNear = near;
          best = k;
        }
      }
      const share = cand.samples.length ? bestNear / cand.samples.length : 0;
      if (best && share >= HOT_DEDUPE_SHARE) {
        best.merged += 1;
        continue;
      }
      if (kept.length < HOT_LIST_MAX) {
        kept.push({ route: cand.route, peak: cand.peak, merged: 0 });
      }
    }

    return kept.map(({ route, peak, merged }) => ({
      id: route.id,
      reason: route.reason,
      lengthLabel: meters(lineLength(route.geometry)),
      converge: Math.max(peak, merged) + 1,
    }));
  }, [routes]);

  // Top neighborhoods by how many sampled route points land inside each polygon
  // (the same points that feed the heatmap).
  const hotNeighborhoods = useMemo<HotNeighborhood[]>(() => {
    if (routes.length < HOT_MIN_ROUTES) return [];
    const counts = new Map<string, number>();
    for (const sample of heatPoints) {
      const name = neighborhoodAt(sample);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    let total = 0;
    for (const c of counts.values()) total += c;
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, share: total ? count / total : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, HOT_LIST_MAX);
  }, [routes, heatPoints]);

  // Resolves to null once its route is gone (e.g. deleted, then refetched), so
  // every consumer below quietly stops showing it — no cleanup effect needed.
  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );

  // The tapped ranked neighborhood's rings, or null. Same "resolves to null when
  // gone" property as `selectedRoute`.
  const selectedNeighborhoodParts = useMemo(
    () => BOSTON_NEIGHBORHOODS.find((n) => n.name === selectedNeighborhood)?.parts ?? null,
    [selectedNeighborhood],
  );

  const selectedNeighborhoodPct = useMemo(() => {
    const hit = hotNeighborhoods.find((n) => n.name === selectedNeighborhood);
    return hit ? Math.round(hit.share * 100) : null;
  }, [hotNeighborhoods, selectedNeighborhood]);

  // Frame the selected route. On mobile the map stays pinned at the top of the
  // screen, so no scrolling is needed to see it.
  useEffect(() => {
    if (!map || !selectedRoute) return;
    map.fitBounds(selectedRoute.geometry, { padding: [48, 48], maxZoom: 15 });
  }, [map, selectedRoute]);

  // Frame the selected neighborhood outline (same rationale as the route above).
  useEffect(() => {
    if (!map || !selectedNeighborhoodParts) return;
    map.fitBounds(selectedNeighborhoodParts.flat(), { padding: [48, 48], maxZoom: 15 });
  }, [map, selectedNeighborhoodParts]);

  const selectRoute = useCallback((id: string) => {
    setSelectedNeighborhood(null);
    setSelectedRouteId((current) => (current === id ? null : id));
  }, []);

  // Route and neighborhood highlights are mutually exclusive; picking one clears
  // the other and the "routes near here" panel.
  const selectNeighborhood = useCallback((name: string) => {
    setSelectedRouteId(null);
    setNearbyQuery(null);
    setSelectedNeighborhood((current) => (current === name ? null : name));
  }, []);

  // Routes passing within NEARBY_RADIUS_M of the tapped point, nearest first.
  const nearbyRoutes = useMemo(() => {
    if (!nearbyQuery) return [];
    return routes
      .map((route) => ({ route, distance: distanceToRoute(nearbyQuery, route.geometry) }))
      .filter((entry) => entry.distance <= NEARBY_RADIUS_M)
      .sort((a, b) => a.distance - b.distance);
  }, [routes, nearbyQuery]);

  // A background tap in view mode drops any highlighted route and toggles the
  // panel: first tap opens it at that point, a second tap anywhere dismisses it.
  const handleBackgroundClick = useCallback((p: LatLng) => {
    setSelectedRouteId(null);
    setSelectedNeighborhood(null);
    setNearbyQuery((current) => (current ? null : p));
  }, []);

  const closeNearby = useCallback(() => {
    setNearbyQuery(null);
    setSelectedRouteId(null);
    setSelectedNeighborhood(null);
  }, []);

  // Nothing nearby: show a brief nudge instead of an empty panel, then clear it.
  // (Same async-timeout pattern as the "outside Boston" hint above.)
  useEffect(() => {
    if (!nearbyQuery || nearbyRoutes.length > 0) return;
    const t = setTimeout(() => setNearbyQuery(null), 2500);
    return () => clearTimeout(t);
  }, [nearbyQuery, nearbyRoutes.length]);

  const drawing = mode === "draw" && !finished;
  const describing = mode === "draw" && finished;
  // On phones, drawing takes over the whole screen: hide the sidebar and let the map fill it.
  const fullscreenDraw = isMobile && mode === "draw";
  const draftMeters = useMemo(() => lineLength(draft), [draft]);

  const resetDraft = useCallback(() => {
    setDraft([]);
    setHover(null);
    setFinished(false);
    setReason("");
    setSubmitError(null);
    setOutsideHint(false);
  }, []);

  // The route must stay entirely within Boston: reject a click that lands
  // outside, or one whose segment from the previous point would leave the city.
  const addPoint = useCallback(
    (p: LatLng) => {
      if (!pointInBoston(p)) {
        setOutsideHint(true);
        return;
      }
      if (draft.length > 0 && !segmentInsideBoston(draft[draft.length - 1], p)) {
        setOutsideHint(true);
        return;
      }
      setOutsideHint(false);
      setDraft((d) => [...d, p]);
    },
    [draft],
  );

  const draftLeavesBoston = useMemo(
    () => draft.length >= 2 && !routeInsideBoston(draft),
    [draft],
  );

  // Mobile: add the point under the fixed crosshair (the map's current centre).
  const addCenterPoint = useCallback(() => {
    if (!map) return;
    const c = map.getCenter();
    addPoint([c.lat, c.lng]);
  }, [map, addPoint]);

  const startDrawing = useCallback(() => {
    resetDraft();
    setSelectedRouteId(null);
    setSelectedNeighborhood(null);
    setNearbyQuery(null);
    setMode("draw");
  }, [resetDraft]);

  const cancelDrawing = useCallback(() => {
    resetDraft();
    setMode("view");
  }, [resetDraft]);

  const undoPoint = useCallback(() => {
    setDraft((d) => d.slice(0, -1));
  }, []);

  const finishDrawing = useCallback(() => {
    setDraft((d) => {
      if (d.length >= 2) setFinished(true);
      return d;
    });
  }, []);

  const submit = useCallback(async () => {
    if (draft.length < 2) return;
    if (!routeInsideBoston(draft)) {
      setSubmitError("The entire route must stay within the City of Boston.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry: draft, reason: reason.trim() || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Submission failed (${res.status})`);
      await loadRoutes();
      resetDraft();
      setMode("view");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }, [draft, reason, loadRoutes, resetDraft]);

  // Keyboard shortcuts: Enter finishes, Escape cancels, Backspace undoes a point.
  useEffect(() => {
    if (mode !== "draw") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrawing();
      if (e.key === "Enter" && drawing) finishDrawing();
      if (e.key === "Backspace" && drawing) {
        e.preventDefault();
        undoPoint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, drawing, cancelDrawing, finishDrawing, undoPoint]);

  const rubberBand: LatLng[] =
    drawing && draft.length > 0 && hover ? [draft[draft.length - 1], hover] : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      {!fullscreenDraw && (
        <Sidebar
          loading={loading}
          loadError={loadError}
          routeCount={routes.length}
          recentReasons={routes
            .filter((r) => r.reason)
            .slice(0, 8)
            .map((r) => ({ id: r.id, reason: r.reason as string, createdAt: r.createdAt }))}
          hotRoutes={hotRoutes}
          hotNeighborhoods={hotNeighborhoods}
          selectedRouteId={selectedRouteId}
          onSelectRoute={selectRoute}
          selectedNeighborhood={selectedNeighborhood}
          onSelectNeighborhood={selectNeighborhood}
          stressOn={stressOn}
          onToggleStress={toggleStress}
          stressLevels={stressLevels}
          onToggleStressLevel={toggleStressLevel}
          stressLoading={stressLoading}
          stressFailed={stressError != null}
          onRetryStress={retryStress}
          mode={mode}
          onStartDrawing={startDrawing}
          onCancelDrawing={cancelDrawing}
        />
      )}

      <div
        className={`relative md:order-2 md:h-auto md:min-h-0 md:flex-1 ${
          fullscreenDraw ? "order-1 flex-1" : "order-1 h-[48vh] shrink-0"
        }`}
      >
        <MapContainer
          ref={setMap}
          center={BOSTON_CENTER}
          zoom={DEFAULT_ZOOM}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxBounds={BOSTON_BOUNDS}
          maxBoundsViscosity={1}
          attributionControl={false}
          className="absolute inset-0 h-full w-full"
        >
          <AttributionControl position="bottomright" prefix={false} />
          <InvalidateOnResize dep={fullscreenDraw} />
          <TileLayer
            attribution='&copy; <a href="https://www.esri.com/">Esri</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            maxZoom={16}
          />

          {/* Traffic-stress overlay — sits above the tiles, below the heat (see the
              "stress" pane). Hidden while drawing, like the heatmap. */}
          {mode === "view" && stressOn && stressData && (
            <StressLayer
              key={stressLevelKey}
              data={stressData}
              renderer={stressRenderer}
              visibleLevels={stressLevels}
            />
          )}

          {/* Hidden during the draw flow so the existing demand can't steer where people route. */}
          {mode === "view" && <HeatLayer points={heatPoints} />}

          {/* City-limits outline, always visible; a dimming mask over everything outside while drawing. */}
          {drawing && (
            <Polygon
              positions={[WORLD_RING, BOSTON_BOUNDARY]}
              pathOptions={{ stroke: false, fillColor: "#0f172a", fillOpacity: 0.25 }}
              interactive={false}
            />
          )}
          <Polygon
            positions={BOSTON_BOUNDARY}
            pathOptions={{
              color: "#0f766e",
              weight: drawing ? 2 : 1.5,
              opacity: drawing ? 0.9 : 0.45,
              dashArray: "5 5",
              fill: false,
            }}
            interactive={false}
          />

          <DrawController
            active={drawing}
            tapToAdd={!isMobile}
            onAddPoint={addPoint}
            onHover={setHover}
          />
          {fullscreenDraw && (
            <CrosshairPreview
              active={drawing}
              from={draft.length > 0 ? draft[draft.length - 1] : null}
            />
          )}

          {mode === "draw" && draft.length > 0 && (
            <>
              <Polyline positions={draft} pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.9 }} />
              <Polyline positions={draft} pathOptions={{ color: "#0e7490", weight: 4 }} />
              {rubberBand.length === 2 && (
                <Polyline
                  positions={rubberBand}
                  pathOptions={{ color: "#0e7490", weight: 3, dashArray: "6 8", opacity: 0.7 }}
                />
              )}
              {draft.map((p, i) => (
                <CircleMarker
                  key={i}
                  center={p}
                  radius={i === 0 ? 6 : 4}
                  pathOptions={{
                    color: "#0e7490",
                    weight: 2,
                    fillColor: i === 0 ? "#0e7490" : "#22d3ee",
                    fillOpacity: 1,
                  }}
                />
              ))}
            </>
          )}

          {/* The route belonging to the comment tapped in the sidebar. */}
          {mode === "view" && selectedRoute && (
            <>
              <Polyline
                positions={selectedRoute.geometry}
                pathOptions={{ color: "#ffffff", weight: 10, opacity: 0.95 }}
                interactive={false}
              />
              <Polyline
                positions={selectedRoute.geometry}
                pathOptions={{ color: "#db2777", weight: 5 }}
                interactive={false}
              />
              {[
                selectedRoute.geometry[0],
                selectedRoute.geometry[selectedRoute.geometry.length - 1],
              ].map((p, i) => (
                <CircleMarker
                  key={i}
                  center={p}
                  radius={6}
                  pathOptions={{
                    color: "#db2777",
                    weight: 3,
                    fillColor: "#ffffff",
                    fillOpacity: 1,
                  }}
                />
              ))}
            </>
          )}
          {/* Outline of the neighborhood tapped in the sidebar ranking. */}
          {mode === "view" && selectedNeighborhoodParts && (
            <Polygon
              positions={selectedNeighborhoodParts}
              pathOptions={{ color: "#db2777", weight: 2, fill: false, dashArray: "4 4" }}
              interactive={false}
            />
          )}
          {/* Marks the point the "routes near here" query was run from. */}
          {mode === "view" && nearbyQuery && nearbyRoutes.length > 0 && (
            <CircleMarker
              center={nearbyQuery}
              radius={7}
              pathOptions={{
                color: "#0f172a",
                weight: 2,
                fillColor: "#38bdf8",
                fillOpacity: 0.9,
              }}
              interactive={false}
            />
          )}
          <ViewClickController
            active={mode === "view"}
            onBackgroundClick={handleBackgroundClick}
          />
        </MapContainer>

        {/* The legend only describes the heat layer, so it hides whenever the heat does. */}
        {mode === "view" && (
          <MapLegend
            compact={isMobile}
            showStress={stressOn && stressData != null}
            stressLevels={stressLevels}
          />
        )}

        {mode === "view" && selectedRoute && (
          <div className="absolute left-3 top-3 z-[1000] flex max-w-[min(20rem,calc(100%-1.5rem))] items-start gap-2 rounded-lg bg-white p-3 shadow-xl ring-1 ring-pink-200">
            <div className="min-w-0">
              <p className="text-xs leading-snug text-slate-700">
                {selectedRoute.reason ? `“${selectedRoute.reason}”` : "This route"}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">
                {new Date(selectedRoute.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                · {meters(lineLength(selectedRoute.geometry))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedRouteId(null)}
              aria-label="Clear highlight"
              className="-mr-1 -mt-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}

        {mode === "view" && selectedNeighborhood && (
          <div className="absolute left-3 top-3 z-[1000] flex items-start gap-2 rounded-lg bg-white p-3 shadow-xl ring-1 ring-pink-200">
            <p className="text-xs leading-snug text-slate-700">
              <span className="font-semibold">{selectedNeighborhood}</span>
              {selectedNeighborhoodPct != null && (
                <span className="text-slate-400"> · {selectedNeighborhoodPct}% of demand</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setSelectedNeighborhood(null)}
              aria-label="Clear neighborhood outline"
              className="-mr-1 -mt-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}

        {mode === "view" && nearbyQuery && (
          <NearbyPanel
            isMobile={isMobile}
            entries={nearbyRoutes}
            selectedRouteId={selectedRouteId}
            onSelect={selectRoute}
            onClose={closeNearby}
          />
        )}

        {fullscreenDraw && drawing && <Crosshair />}

        {fullscreenDraw && drawing && (
          <button
            type="button"
            onClick={cancelDrawing}
            aria-label="Cancel drawing"
            className="absolute right-3 top-3 z-[1000] flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg leading-none text-slate-600 shadow-lg ring-1 ring-black/10"
          >
            ✕
          </button>
        )}

        {mode === "draw" && (
          <DrawCard
            drawing={drawing}
            describing={describing}
            isMobile={isMobile}
            pointCount={draft.length}
            meters={draftMeters}
            outsideHint={outsideHint}
            leavesBoston={draftLeavesBoston}
            reason={reason}
            submitting={submitting}
            submitError={submitError}
            onReasonChange={setReason}
            onAddCenterPoint={addCenterPoint}
            onUndo={undoPoint}
            onClear={resetDraft}
            onFinish={finishDrawing}
            onCancel={cancelDrawing}
            onBackToDrawing={() => setFinished(false)}
            onSubmit={submit}
          />
        )}
      </div>
    </div>
  );
}

function MapLegend({
  compact = false,
  showStress = false,
  stressLevels,
}: {
  compact?: boolean;
  showStress?: boolean;
  stressLevels?: ReadonlySet<number>;
}) {
  return (
    <div
      className={`pointer-events-none absolute z-[1000] flex flex-col items-end gap-2 ${
        compact ? "bottom-2 right-2" : "bottom-6 right-3"
      }`}
    >
      {showStress && <StressLegendCard compact={compact} visibleLevels={stressLevels} />}
      <LegendCard compact={compact} title="Demand">
        <div
          className={`rounded-full bg-[linear-gradient(to_right,#1d4ed8,#0891b2,#16a34a,#eab308,#f97316,#dc2626)] ${
            compact ? "h-1.5 w-28" : "h-2 w-40"
          }`}
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>fewer</span>
          <span>more</span>
        </div>
      </LegendCard>
    </div>
  );
}

function LegendCard({
  compact,
  title,
  children,
}: {
  compact: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-md bg-white/90 shadow-md ring-1 ring-black/10 backdrop-blur ${
        compact ? "p-2" : "p-3"
      }`}
    >
      <div
        className={`font-semibold text-slate-700 ${compact ? "mb-0.5 text-[11px]" : "mb-1 text-xs"}`}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Off-street + LTS 1–4 swatches, shown while the traffic-stress overlay is on.
 * Rows for levels hidden by the sidebar filter are dimmed.
 */
function StressLegendCard({
  compact,
  visibleLevels,
}: {
  compact: boolean;
  visibleLevels?: ReadonlySet<number>;
}) {
  return (
    <LegendCard compact={compact} title="Traffic stress">
      <ul className={`space-y-1 text-slate-600 ${compact ? "text-[10px]" : "text-[11px]"}`}>
        {[0, 1, 2, 3, 4].map((lts) => (
          <li
            key={lts}
            className={`flex items-center gap-1.5 ${
              visibleLevels && !visibleLevels.has(lts) ? "opacity-35" : ""
            }`}
          >
            <span
              className="inline-block h-1 w-4 shrink-0 rounded-full"
              style={{ backgroundColor: LTS_COLOR[lts] }}
            />
            <span>{compact ? (lts === 0 ? "Off-street" : `LTS ${lts}`) : LTS_LABEL[lts]}</span>
          </li>
        ))}
      </ul>
    </LegendCard>
  );
}

function meters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/**
 * Lists the routes found near a view-mode background tap. Desktop: a card in the
 * top-right, clear of the legend (bottom-right) and the highlight chip
 * (top-left). Mobile: a bottom sheet styled like `DrawCard`, but `fixed` rather
 * than `absolute` — in view mode the map is only ~48vh, so it has to pin to the
 * viewport, not the map box. Tapping an entry highlights that route and frames
 * it (via `selectedRouteId`).
 */
function NearbyPanel({
  isMobile,
  entries,
  selectedRouteId,
  onSelect,
  onClose,
}: {
  isMobile: boolean;
  entries: { route: BikeRoute; distance: number }[];
  selectedRouteId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
        No routes within {NEARBY_RADIUS_M} m of there
      </div>
    );
  }

  return (
    <div
      className={
        isMobile
          ? "fixed inset-x-0 bottom-0 z-[1000] max-h-[60vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-[0_-6px_24px_rgba(0,0,0,0.18)] ring-1 ring-black/10"
          : "absolute right-3 top-3 z-[1000] max-h-[calc(100%-6.5rem)] w-72 overflow-y-auto rounded-lg bg-white p-4 shadow-xl ring-1 ring-black/10"
      }
    >
      {isMobile && <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" />}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">
          {entries.length} route{entries.length === 1 ? "" : "s"} near here
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
      <ul className="mt-2 space-y-2">
        {entries.map(({ route, distance }) => {
          const active = route.id === selectedRouteId;
          return (
            <li key={route.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(route.id)}
                className={`block w-full rounded-md p-3 text-left text-xs transition-colors ${
                  active
                    ? "bg-pink-50 text-slate-800 ring-2 ring-pink-500"
                    : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"
                }`}
              >
                <p className={`leading-snug ${route.reason ? "" : "italic text-slate-400"}`}>
                  {route.reason ? `“${route.reason}”` : "no note"}
                </p>
                <p className={`mt-1 text-[11px] ${active ? "text-pink-600" : "text-slate-400"}`}>
                  {new Date(route.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  · {meters(lineLength(route.geometry))} · {route.geometry.length} points ·{" "}
                  {meters(distance)} away
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DrawCard({
  drawing,
  describing,
  isMobile,
  pointCount,
  meters: routeMeters,
  outsideHint,
  leavesBoston,
  reason,
  submitting,
  submitError,
  onReasonChange,
  onAddCenterPoint,
  onUndo,
  onClear,
  onFinish,
  onCancel,
  onBackToDrawing,
  onSubmit,
}: {
  drawing: boolean;
  describing: boolean;
  isMobile: boolean;
  pointCount: number;
  meters: number;
  outsideHint: boolean;
  leavesBoston: boolean;
  reason: string;
  submitting: boolean;
  submitError: string | null;
  onReasonChange: (v: string) => void;
  onAddCenterPoint: () => void;
  onUndo: () => void;
  onClear: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onBackToDrawing: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className={
        isMobile
          ? "absolute inset-x-0 bottom-0 z-[1000] max-h-[60vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-[0_-6px_24px_rgba(0,0,0,0.18)] ring-1 ring-black/10"
          : "absolute left-3 top-3 z-[1000] w-72 rounded-lg bg-white p-4 shadow-xl ring-1 ring-black/10"
      }
    >
      {isMobile && <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" />}
      {drawing && (
        <>
          <h2 className="text-sm font-semibold text-slate-800">Draw a bike route</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {isMobile
              ? "Pan the map so the crosshair sits on the street, then Add point. The whole route must stay inside Boston (the outlined area)."
              : "Click along the streets where a protected bike lane is needed, then finish. The whole route must stay inside the City of Boston (the outlined area)."}
          </p>
          <dl className="mt-3 flex gap-4 text-xs text-slate-600">
            <div>
              <dt className="text-slate-400">Points</dt>
              <dd className="font-semibold">{pointCount}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Length</dt>
              <dd className="font-semibold">{meters(routeMeters)}</dd>
            </div>
          </dl>
          {isMobile && (
            <button
              type="button"
              onClick={onAddCenterPoint}
              className="mt-3 w-full rounded-md bg-cyan-700 px-2 py-3 text-sm font-semibold text-white hover:bg-cyan-800 active:bg-cyan-900"
            >
              + Add point
            </button>
          )}
          <div className={`grid grid-cols-2 gap-2 ${isMobile ? "mt-2" : "mt-3"}`}>
            <button
              type="button"
              onClick={onUndo}
              disabled={pointCount === 0}
              className="rounded-md border border-slate-300 px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Undo point
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={pointCount === 0}
              className="rounded-md border border-slate-300 px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onFinish}
              disabled={pointCount < 2 || leavesBoston}
              className="rounded-md bg-cyan-700 px-2 py-2 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-40"
            >
              Finish route
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-2 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
          {outsideHint && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
              That would take the route outside Boston. Keep every point and segment inside the
              outlined area.
            </p>
          )}
          {leavesBoston && !outsideHint && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
              This route leaves the City of Boston — it can’t be submitted.
            </p>
          )}
          {!isMobile && (
            <p className="mt-2 text-[10px] text-slate-400">
              Shortcuts: Enter finishes · Backspace removes a point · Esc cancels
            </p>
          )}
        </>
      )}

      {describing && (
        <>
          <h2 className="text-sm font-semibold text-slate-800">Why this route?</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Optional — a sentence on why this corridor matters (commute, school run, a dangerous
            junction…).
          </p>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            placeholder="This is the only direct link from Dorchester to the Longwood hospitals and it has no bike lane."
            className="mt-2 w-full resize-none rounded-md border border-slate-300 p-2 text-xs text-slate-800 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
          />
          <div className="mt-1 text-right text-[10px] text-slate-400">
            {reason.length}/{MAX_REASON_LENGTH}
          </div>
          {submitError && <p className="mt-1 text-xs text-red-600">{submitError}</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onBackToDrawing}
              disabled={submitting}
              className="rounded-md border border-slate-300 px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-md bg-cyan-700 px-2 py-2 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Add to map"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
