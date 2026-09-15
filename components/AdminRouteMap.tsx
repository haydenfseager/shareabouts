"use client";

import { MapContainer, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/geo";

/**
 * Read-only preview of a single route's shape, for /admin. Fits the map to
 * the route's own bounding box (not the whole city) so an admin can quickly
 * eyeball whether a submission is a plausible corridor or something drawn to
 * be an inappropriate shape — without leaving the moderation list. Never
 * mounted during SSR (see the dynamic import in admin/page.tsx) since Leaflet
 * touches `window`.
 */
export default function AdminRouteMap({ geometry }: { geometry: LatLng[] }) {
  return (
    <div className="h-64 w-full overflow-hidden rounded-md ring-1 ring-slate-200">
      <MapContainer
        bounds={geometry}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom={false}
        attributionControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
        <Polyline
          positions={geometry}
          pathOptions={{ color: "#be123c", weight: 4, opacity: 0.9 }}
        />
      </MapContainer>
    </div>
  );
}
