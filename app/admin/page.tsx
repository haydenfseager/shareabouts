"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminBikeRoute } from "@/lib/types";

const TOKEN_KEY = "shareabouts-admin-token";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [routes, setRoutes] = useState<AdminBikeRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TOKEN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setToken(saved);
    } catch {
      // sessionStorage unavailable — fine, the field just starts empty.
    }
  }, []);

  // Without a token this is the public list (hidden routes excluded). With one,
  // request the admin view (`?all=1`), which also includes hidden routes and
  // each one's report count.
  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(token ? "/api/routes?all=1" : "/api/routes", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      // The plain (non-admin) endpoint returns BikeRoute[] with no report/hidden
      // fields at all; default those in rather than claiming the stronger type.
      const data = (await res.json()) as {
        routes: (Omit<AdminBikeRoute, "reportCount" | "hidden"> &
          Partial<Pick<AdminBikeRoute, "reportCount" | "hidden">>)[];
      };
      setRoutes(data.routes.map((r) => ({ reportCount: 0, hidden: false, ...r })));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load routes.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // Mount-only: shows the public list before a token is entered/restored.
    // Loading with admin visibility happens when the user clicks Reload (or
    // after a saved token is restored above and they reload), not on every
    // keystroke in the token field — `load` isn't a dependency here on purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remember = (value: string) => {
    setToken(value);
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      // ignore
    }
  };

  const remove = useCallback(
    async (id: string) => {
      if (!token) {
        setMessage("Enter the admin token first.");
        return;
      }
      if (!confirm("Delete this route permanently?")) return;
      setBusyId(id);
      setMessage(null);
      try {
        const res = await fetch(`/api/routes/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Delete failed (${res.status})`);
        setRoutes((rs) => rs.filter((r) => r.id !== id));
        setMessage(`Deleted ${id}`);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Delete failed.");
      } finally {
        setBusyId(null);
      }
    },
    [token],
  );

  const ban = useCallback(
    async (id: string) => {
      if (!token) {
        setMessage("Enter the admin token first.");
        return;
      }
      if (!confirm("Ban this route's submitter (by IP) and delete the route?")) return;
      setBusyId(id);
      setMessage(null);
      try {
        const res = await fetch(`/api/routes/${id}/ban`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Ban failed (${res.status})`);
        setRoutes((rs) => rs.filter((r) => r.id !== id));
        setMessage(`Banned the submitter and deleted ${id}`);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Ban failed.");
      } finally {
        setBusyId(null);
      }
    },
    [token],
  );

  const unhide = useCallback(
    async (id: string) => {
      if (!token) {
        setMessage("Enter the admin token first.");
        return;
      }
      setBusyId(id);
      setMessage(null);
      try {
        const res = await fetch(`/api/routes/${id}/unhide`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Unhide failed (${res.status})`);
        setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, hidden: false } : r)));
        setMessage(`Unhid ${id}`);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Unhide failed.");
      } finally {
        setBusyId(null);
      }
    },
    [token],
  );

  const banReporters = useCallback(
    async (id: string, reportCount: number) => {
      if (!token) {
        setMessage("Enter the admin token first.");
        return;
      }
      const plural = reportCount === 1 ? "" : "s";
      if (
        !confirm(
          `Ban ${reportCount} reporter IP${plural} and restore this route? Use this only if the reports ` +
            "look like a coordinated attempt to hide a legitimate route, not genuine abuse.",
        )
      ) {
        return;
      }
      setBusyId(id);
      setMessage(null);
      try {
        const res = await fetch(`/api/routes/${id}/ban-reporters`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          bannedCount?: number;
        };
        if (!res.ok) throw new Error(data.error ?? `Ban reporters failed (${res.status})`);
        setRoutes((rs) =>
          rs.map((r) => (r.id === id ? { ...r, hidden: false, reportCount: 0 } : r)),
        );
        setMessage(`Banned ${data.bannedCount ?? 0} reporter IP${plural} and restored ${id}`);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Ban reporters failed.");
      } finally {
        setBusyId(null);
      }
    },
    [token],
  );

  return (
    <main className="mx-auto max-w-3xl p-6 text-slate-800">
      <h1 className="text-xl font-bold">Route moderation</h1>
      <p className="mt-1 text-sm text-slate-500">
        Remove spam or bad submissions. The token is your <code>ADMIN_TOKEN</code> env var; it is
        kept only in this tab&rsquo;s session storage. With a token entered, Reload also shows
        reported/hidden routes. If a route was hidden by genuine abuse, use <strong>Unhide</strong>.
        If it looks like a handful of people coordinated to report-bomb a legitimate route, use{" "}
        <strong>Ban reporters &amp; restore</strong> instead — it also blocks those IPs from
        reporting again.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Admin token
          </span>
          <input
            type="password"
            value={token}
            onChange={(e) => remember(e.target.value)}
            className="mt-1 w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
            placeholder="paste ADMIN_TOKEN"
          />
        </label>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          Reload
        </button>
      </div>

      {message && (
        <p className="mt-3 rounded bg-slate-100 px-3 py-2 text-xs text-slate-700">{message}</p>
      )}

      <p className="mt-4 text-sm text-slate-500">
        {loading ? "Loading…" : `${routes.length} route${routes.length === 1 ? "" : "s"}`}
      </p>

      <ul className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
        {routes.map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-slate-800">
                  {r.reason ? `“${r.reason}”` : <span className="text-slate-400">no comment</span>}
                </p>
                {r.hidden && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Hidden
                  </span>
                )}
                {r.reportCount > 0 && (
                  <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                    {r.reportCount} report{r.reportCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {r.zip ? `ZIP ${r.zip}` : <span className="text-slate-400">ZIP —</span>}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {new Date(r.createdAt).toLocaleString()} · {r.geometry.length} points ·{" "}
                <span className="font-mono">{r.id}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex gap-1.5">
                {r.hidden && (
                  <button
                    type="button"
                    onClick={() => unhide(r.id)}
                    disabled={busyId === r.id}
                    className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {busyId === r.id ? "…" : "Unhide"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  disabled={busyId === r.id}
                  className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {busyId === r.id ? "Deleting…" : "Delete"}
                </button>
              </div>
              {r.reportCount > 0 && (
                <button
                  type="button"
                  onClick={() => banReporters(r.id, r.reportCount)}
                  disabled={busyId === r.id}
                  title="Ban every reporter's IP and restore this route — for coordinated report-bombing, not genuine abuse"
                  className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                >
                  Ban reporters &amp; restore
                </button>
              )}
              <button
                type="button"
                onClick={() => ban(r.id)}
                disabled={busyId === r.id}
                className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                Ban &amp; Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
