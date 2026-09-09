"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` on import, so the map must never render on the server.
const BikeMap = dynamic(() => import("./BikeMap"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
      Loading map…
    </div>
  ),
});

export function MapClient() {
  return <BikeMap />;
}
