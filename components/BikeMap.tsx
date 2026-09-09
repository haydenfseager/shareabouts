"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  CircleMarker,
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

import {
  BOSTON_BOUNDS,
  BOSTON_CENTER,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  lineLength,
  sampleLine,
  type LatLng,
} from "@/lib/geo";
import { BOSTON_BOUNDARY, fractionInsideBoston, pointInBoston } from "@/lib/boston-boundary";
import { MAX_REASON_LENGTH, MIN_BOSTON_FRACTION } from "@/lib/validate";
import type { BikeRoute } from "@/lib/types";
import { Sidebar } from "./Sidebar";

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

/** Turns map clicks into route vertices while in draw mode. */
function DrawController({
  active,
  onAddPoint,
  onHover,
}: {
  active: boolean;
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
      if (active) onAddPoint([e.latlng.lat, e.latlng.lng]);
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

export default function BikeMap() {
  const [routes, setRoutes] = useState<BikeRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [hover, setHover] = useState<LatLng | null>(null);
  const [finished, setFinished] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outsideHint, setOutsideHint] = useState(false);

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

  const drawing = mode === "draw" && !finished;
  const describing = mode === "draw" && finished;
  const draftMeters = useMemo(() => lineLength(draft), [draft]);

  const resetDraft = useCallback(() => {
    setDraft([]);
    setHover(null);
    setFinished(false);
    setReason("");
    setSubmitError(null);
    setOutsideHint(false);
  }, []);

  // Route vertices must land inside the City of Boston; ignore clicks that don't.
  const addPoint = useCallback((p: LatLng) => {
    if (!pointInBoston(p)) {
      setOutsideHint(true);
      return;
    }
    setOutsideHint(false);
    setDraft((d) => [...d, p]);
  }, []);

  const draftInsideFraction = useMemo(
    () => (draft.length >= 2 ? fractionInsideBoston(draft) : 1),
    [draft],
  );

  const startDrawing = useCallback(() => {
    resetDraft();
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
    if (fractionInsideBoston(draft) < MIN_BOSTON_FRACTION) {
      setSubmitError("Most of the route must be within the City of Boston.");
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
      <Sidebar
        loading={loading}
        loadError={loadError}
        routeCount={routes.length}
        recentReasons={routes
          .filter((r) => r.reason)
          .slice(0, 8)
          .map((r) => ({ id: r.id, reason: r.reason as string, createdAt: r.createdAt }))}
        mode={mode}
        onStartDrawing={startDrawing}
        onCancelDrawing={cancelDrawing}
      />

      <div className="relative order-1 h-[48vh] shrink-0 md:order-2 md:h-auto md:min-h-0 md:flex-1">
        <MapContainer
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
          <TileLayer
            attribution='&copy; <a href="https://www.esri.com/">Esri</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            maxZoom={16}
          />

          <HeatLayer points={heatPoints} />

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

          <DrawController active={drawing} onAddPoint={addPoint} onHover={setHover} />

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
        </MapContainer>

        <MapLegend />

        {mode === "draw" && (
          <DrawCard
            drawing={drawing}
            describing={describing}
            pointCount={draft.length}
            meters={draftMeters}
            outsideHint={outsideHint}
            mostlyOutside={draft.length >= 2 && draftInsideFraction < MIN_BOSTON_FRACTION}
            reason={reason}
            submitting={submitting}
            submitError={submitError}
            onReasonChange={setReason}
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

function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-6 right-3 z-[1000] rounded-md bg-white/90 p-3 text-xs shadow-md ring-1 ring-black/10 backdrop-blur">
      <div className="mb-1 font-semibold text-slate-700">Demand</div>
      <div className="h-2 w-40 rounded-full bg-[linear-gradient(to_right,#1d4ed8,#0891b2,#16a34a,#eab308,#f97316,#dc2626)]" />
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>fewer requests</span>
        <span>more</span>
      </div>
    </div>
  );
}

function meters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function DrawCard({
  drawing,
  describing,
  pointCount,
  meters: routeMeters,
  outsideHint,
  mostlyOutside,
  reason,
  submitting,
  submitError,
  onReasonChange,
  onUndo,
  onClear,
  onFinish,
  onCancel,
  onBackToDrawing,
  onSubmit,
}: {
  drawing: boolean;
  describing: boolean;
  pointCount: number;
  meters: number;
  outsideHint: boolean;
  mostlyOutside: boolean;
  reason: string;
  submitting: boolean;
  submitError: string | null;
  onReasonChange: (v: string) => void;
  onUndo: () => void;
  onClear: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onBackToDrawing: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="absolute left-3 top-3 z-[1000] w-72 rounded-lg bg-white p-4 shadow-xl ring-1 ring-black/10">
      {drawing && (
        <>
          <h2 className="text-sm font-semibold text-slate-800">Draw a bike route</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Click along the streets where a protected bike lane is needed. Add as many points as you
            like, then finish.
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
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onUndo}
              disabled={pointCount === 0}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Undo point
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={pointCount === 0}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onFinish}
              disabled={pointCount < 2 || mostlyOutside}
              className="rounded-md bg-cyan-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-40"
            >
              Finish route
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
          {outsideHint && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
              That spot is outside the City of Boston. Click within the outlined area.
            </p>
          )}
          {mostlyOutside && !outsideHint && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
              Most of this route is outside Boston — it can’t be submitted yet.
            </p>
          )}
          <p className="mt-2 text-[10px] text-slate-400">
            Shortcuts: Enter finishes · Backspace removes a point · Esc cancels
          </p>
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
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-md bg-cyan-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Add to map"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
