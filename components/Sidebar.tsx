"use client";

import type { HotNeighborhood, HotRoute } from "@/lib/types";
import { STRESS_DATASET } from "@/lib/stress-network";

type RecentReason = { id: string; reason: string; createdAt: string };

export function Sidebar({
  loading,
  loadError,
  routeCount,
  recentReasons,
  hotRoutes,
  hotNeighborhoods,
  selectedRouteId,
  onSelectRoute,
  selectedNeighborhood,
  onSelectNeighborhood,
  heatOn,
  onToggleHeat,
  stressOn,
  onToggleStress,
  stressLoading,
  stressZoomedOut,
  stressFailed,
  onRetryStress,
  mode,
  onStartDrawing,
  onCancelDrawing,
}: {
  loading: boolean;
  loadError: string | null;
  routeCount: number;
  recentReasons: RecentReason[];
  hotRoutes: HotRoute[];
  hotNeighborhoods: HotNeighborhood[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  selectedNeighborhood: string | null;
  onSelectNeighborhood: (name: string) => void;
  heatOn: boolean;
  onToggleHeat: (on: boolean) => void;
  stressOn: boolean;
  onToggleStress: (on: boolean) => void;
  stressLoading: boolean;
  stressZoomedOut: boolean;
  stressFailed: boolean;
  onRetryStress: () => void;
  mode: "view" | "draw";
  onStartDrawing: () => void;
  onCancelDrawing: () => void;
}) {
  // Nothing meaningful to rank under three routes — hide both sections entirely.
  const showRankings = routeCount >= 3;
  return (
    <aside className="order-2 flex w-full min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-slate-200 bg-white p-5 md:order-1 md:w-80 md:flex-none md:border-t-0 md:border-r">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Boston Bike Lane Priorities</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Draw the routes where <strong>you</strong> most want a protected bike lane. Every
          submission adds heat to the map — the corridors the whole city asks for glow brightest.
        </p>
      </div>

      <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="text-3xl font-bold tabular-nums text-cyan-700">
          {loading ? "—" : routeCount}
        </div>
        <div className="text-xs uppercase tracking-wide text-slate-500">routes submitted</div>
        {loadError && <div className="mt-2 text-xs text-red-600">{loadError}</div>}
      </div>

      {mode === "view" ? (
        <button
          type="button"
          onClick={onStartDrawing}
          className="rounded-md bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-800"
        >
          + Draw a route
        </button>
      ) : (
        <button
          type="button"
          onClick={onCancelDrawing}
          className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Stop drawing
        </button>
      )}

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Traffic-stress overlay
        </h2>
        <p className="mt-1 text-[11px] text-slate-400">
          Color every Boston street by its Bicycle Level of Traffic Stress — LTS&nbsp;1 is calm
          enough for most riders, LTS&nbsp;4 is heavy, fast traffic. See how the corridors people
          ask for line up with the streets that already feel safe.
        </p>
        <label
          className={`mt-2 flex cursor-pointer items-start gap-2 rounded-md p-2.5 text-sm transition-colors ${
            stressOn
              ? "bg-pink-50 text-slate-800 ring-2 ring-pink-500"
              : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-pink-600"
            checked={stressOn}
            onChange={(e) => onToggleStress(e.target.checked)}
          />
          <span className="min-w-0">
            <span className="block font-medium leading-snug">Show the {STRESS_DATASET.label}</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">{STRESS_DATASET.blurb}</span>
          </span>
        </label>
        {stressLoading && (
          <p className="mt-2 text-[11px] text-slate-400">Loading stress network…</p>
        )}
        {stressZoomedOut && !stressLoading && (
          <p className="mt-2 text-[11px] text-slate-400">Zoom in to see the stress network.</p>
        )}
        {stressFailed && (
          <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
            Couldn&rsquo;t load the stress network.{" "}
            <button type="button" onClick={onRetryStress} className="font-semibold underline">
              Try again
            </button>
          </p>
        )}
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Demand heatmap
        </h2>
        <p className="mt-1 text-[11px] text-slate-400">
          The heat built from every submitted route. On by default — turn it off to read the
          base map or the stress overlay on its own.
        </p>
        <label
          className={`mt-2 flex cursor-pointer items-start gap-2 rounded-md p-2.5 text-sm transition-colors ${
            heatOn
              ? "bg-pink-50 text-slate-800 ring-2 ring-pink-500"
              : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-pink-600"
            checked={heatOn}
            onChange={(e) => onToggleHeat(e.target.checked)}
          />
          <span className="min-w-0">
            <span className="block font-medium leading-snug">Show the demand heatmap</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">
              Warmer colors mean more people asking for a lane there
            </span>
          </span>
        </label>
      </div>

      {showRankings && hotRoutes.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Most requested corridors
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">
            Where the most submitted routes pile onto the same streets. Tap to highlight one.
          </p>
          <ul className="mt-2 space-y-2">
            {hotRoutes.map((r) => {
              const active = r.id === selectedRouteId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectRoute(r.id)}
                    className={`block w-full rounded-md p-3 text-left text-sm transition-colors ${
                      active
                        ? "bg-pink-50 text-slate-800 ring-2 ring-pink-500"
                        : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"
                    }`}
                  >
                    <p className={`leading-snug ${r.reason ? "" : "italic text-slate-400"}`}>
                      {r.reason ? `“${r.reason}”` : "no note"}
                    </p>
                    <p className={`mt-1 text-[11px] ${active ? "text-pink-600" : "text-slate-400"}`}>
                      {r.lengthLabel} · ~{r.converge} routes converge here (approx.)
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showRankings && hotNeighborhoods.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Hottest neighborhoods
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">
            Share of all mapped demand that runs through each. Tap to outline it.
          </p>
          <ul className="mt-2 space-y-2">
            {hotNeighborhoods.map((n) => {
              const active = n.name === selectedNeighborhood;
              const pct = Math.round(n.share * 100);
              return (
                <li key={n.name}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectNeighborhood(n.name)}
                    className={`block w-full rounded-md p-3 text-left text-sm transition-colors ${
                      active
                        ? "bg-pink-50 text-slate-800 ring-2 ring-pink-500"
                        : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{n.name}</span>
                      <span
                        className={`shrink-0 tabular-nums text-xs ${
                          active ? "text-pink-600" : "text-slate-500"
                        }`}
                      >
                        {pct}%
                      </span>
                    </div>
                    <p className={`mt-1 text-[11px] ${active ? "text-pink-600" : "text-slate-400"}`}>
                      {n.count} route points mapped here
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          What people are saying
        </h2>
        {recentReasons.length > 0 && (
          <p className="mt-1 text-[11px] text-slate-400">Tap a comment to find its route.</p>
        )}
        <ul className="mt-2 space-y-2">
          {recentReasons.length === 0 && (
            <li className="text-sm text-slate-400">
              No comments yet. Be the first to explain why a route matters.
            </li>
          )}
          {recentReasons.map((r) => {
            const active = r.id === selectedRouteId;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectRoute(r.id)}
                  className={`block w-full rounded-md p-3 text-left text-sm transition-colors ${
                    active
                      ? "bg-pink-50 text-slate-800 ring-2 ring-pink-500"
                      : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"
                  }`}
                >
                  <p className="leading-snug">“{r.reason}”</p>
                  <p className={`mt-1 text-[11px] ${active ? "text-pink-600" : "text-slate-400"}`}>
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    {active && " · shown on map"}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-auto border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-400">
        Anonymous demonstration project. Submissions are public and stored only for this demo. Base
        map © Esri, © OpenStreetMap contributors.
      </p>
    </aside>
  );
}
