"use client";

import { useCallback, useEffect, useState } from "react";
import type { BikeRoute } from "@/lib/types";

const TOKEN_KEY = "shareabouts-admin-token";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [routes, setRoutes] = useState<BikeRoute[]>([]);
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

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routes", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as { routes: BikeRoute[] };
      setRoutes(data.routes);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load routes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; state updates happen after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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

  return (
    <main className="mx-auto max-w-3xl p-6 text-slate-800">
      <h1 className="text-xl font-bold">Route moderation</h1>
      <p className="mt-1 text-sm text-slate-500">
        Remove spam or bad submissions. The token is your <code>ADMIN_TOKEN</code> env var; it is
        kept only in this tab&rsquo;s session storage.
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
              <p className="text-slate-800">
                {r.reason ? `“${r.reason}”` : <span className="text-slate-400">no comment</span>}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {r.zip ? `ZIP ${r.zip}` : <span className="text-slate-400">ZIP —</span>}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {new Date(r.createdAt).toLocaleString()} · {r.geometry.length} points ·{" "}
                <span className="font-mono">{r.id}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(r.id)}
              disabled={busyId === r.id}
              className="shrink-0 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {busyId === r.id ? "Deleting…" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
