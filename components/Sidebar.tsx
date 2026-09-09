"use client";

type RecentReason = { id: string; reason: string; createdAt: string };

export function Sidebar({
  loading,
  loadError,
  routeCount,
  recentReasons,
  mode,
  onStartDrawing,
  onCancelDrawing,
}: {
  loading: boolean;
  loadError: string | null;
  routeCount: number;
  recentReasons: RecentReason[];
  mode: "view" | "draw";
  onStartDrawing: () => void;
  onCancelDrawing: () => void;
}) {
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
          What people are saying
        </h2>
        <ul className="mt-2 space-y-2">
          {recentReasons.length === 0 && (
            <li className="text-sm text-slate-400">
              No comments yet. Be the first to explain why a route matters.
            </li>
          )}
          {recentReasons.map((r) => (
            <li
              key={r.id}
              className="rounded-md bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200"
            >
              <p className="leading-snug">“{r.reason}”</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {new Date(r.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-auto border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-400">
        Anonymous demonstration project. Submissions are public and stored only for this demo. Base
        map © Esri, © OpenStreetMap contributors.
      </p>
    </aside>
  );
}
