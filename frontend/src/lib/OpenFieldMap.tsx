import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import 'leaflet/dist/leaflet.css';
import type { FieldMapProps } from './mapTypes';

export function OpenFieldMap({ latitude, longitude, fieldName = '', zoom = 14, boundaryGeojson, stressGeojson, tileUrl, overlay, opacity = .8 }: FieldMapProps) {
  const element = useRef<HTMLDivElement>(null);
  const [failedLayer, setFailedLayer] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!element.current) return;
    const map = L.map(element.current, { scrollWheelZoom: true, maxZoom: 20, zoomAnimation: false }).setView([latitude, longitude], zoom);
    const basemap = L.tileLayer(import.meta.env.VITE_OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19, maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      keepBuffer: 0,
    }).addTo(map);
    basemap.on('tileerror', () => setFailedLayer('basemap'));
    basemap.on('tileload', () => setFailedLayer(current => current === 'basemap' ? null : current));
    const label = document.createElement('span'); label.textContent = fieldName;
    L.circleMarker([latitude, longitude], { radius: 4, color: '#1f2937', fillColor: '#fff', fillOpacity: 1 }).bindTooltip(label).addTo(map);
    let bounds: L.LatLngBounds | undefined;
    if (boundaryGeojson) {
      const boundary = L.geoJSON(boundaryGeojson as unknown as GeoJsonObject, {
        style: { color: '#cbe86b', weight: 3, fillOpacity: 0.04 },
      }).addTo(map);
      if (boundary.getBounds().isValid()) { bounds = boundary.getBounds(); map.fitBounds(bounds.pad(0.35), { maxZoom: 18, animate: false }); }
    }
    if (tileUrl && bounds) {
      const ndvi = L.tileLayer(tileUrl, { bounds, opacity, maxZoom: 20, keepBuffer: 0, attribution: 'NDVI: Copernicus Sentinel-2 / Earth Search' }).addTo(map);
      ndvi.on('tileerror', () => setFailedLayer(tileUrl));
      ndvi.on('tileload', () => setFailedLayer(current => current === tileUrl ? null : current));
    }
    if (overlay) L.imageOverlay(overlay.image, [[overlay.bounds.south, overlay.bounds.west], [overlay.bounds.north, overlay.bounds.east]], { opacity }).addTo(map);
    if (stressGeojson) L.geoJSON(stressGeojson as unknown as GeoJsonObject, { style: { color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.3, weight: 2 } }).addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(element.current);
    return () => { observer.disconnect(); basemap.off(); map.remove(); };
  }, [latitude, longitude, fieldName, zoom, boundaryGeojson, stressGeojson, tileUrl, overlay, opacity, attempt]);
  const error = failedLayer === 'basemap' ? 'Street-map tiles could not load. The field boundary is still available.'
    : failedLayer && failedLayer === tileUrl ? 'NDVI tiles could not load for this observation. Try another scene or retry.' : '';
  return <div className="open-map-frame">
    <div className="open-field-map" ref={element} aria-label={`Field map of ${fieldName}`} />
    <span className="map-source-label">OpenStreetMap basemap{tileUrl ? ' · Sentinel-2 NDVI' : ''}</span>
    {error && <div className="map-load-error" role="alert">{error} <button type="button" onClick={() => { setFailedLayer(null); setAttempt(value => value + 1); }}>Retry map tiles</button></div>}
  </div>;
}
