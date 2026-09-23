import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildRoute, nearestPointIndex } from './routeGeometry';
import './RouteMap.css';

const EMPTY = [];
const NOOP = () => {};
const formatNumber = (number, digits = 1) => Number.isFinite(number) ? number.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '—';
const formatTime = seconds => {
  if (!Number.isFinite(seconds)) return '—';
  const value = Math.round(seconds);
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(n => String(n).padStart(2, '0')).join(':');
};

export default function RouteMap({ data = EMPTY, selectedRecord = null, onSelectRecord = NOOP }) {
  const route = useMemo(() => buildRoute(data), [data]);
  const pointsByRecord = useMemo(() => new Map(route.points.map(point => [point.record, point])), [route]);
  const record = selectedRecord || route.points[0]?.record;
  const current = pointsByRecord.get(record);
  const host = useRef(null);
  const mapRef = useRef(null);
  const tilesRef = useRef(null);
  const cursorRef = useRef(null);
  const fitRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    if (!window.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [route]);

  useEffect(() => {
    if (!visible || !host.current || !route.points.length) return;
    const map = L.map(host.current, { scrollWheelZoom: false, attributionControl: true });
    mapRef.current = map;
    map.zoomControl.setPosition('topleft');
    const tiles = L.tileLayer(process.env.REACT_APP_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
      keepBuffer: 0,
      updateWhenIdle: true,
      // Browser caching and a normal Referer follow the OSM tile usage policy.
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    tiles.on('tileerror', () => setTileError(true));
    tiles.addTo(map);
    tilesRef.current = tiles;
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    const bounds = L.latLngBounds(route.points.map(point => point.position));
    const fit = () => map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15, animate: false });
    fitRef.current = fit;
    route.segments.forEach(segment => {
      if (segment.length < 2) return;
      // A pale casing keeps the actual trace visible over roads and place labels.
      L.polyline(segment, { color: 'white', weight: 7, opacity: 0.9, interactive: false }).addTo(map);
      L.polyline(segment, { color: '#c2410c', weight: 4, opacity: 0.9 }).addTo(map).on('click', event => {
        const index = nearestPointIndex(route.points, event.latlng);
        if (index >= 0) onSelectRecord(route.points[index].record);
      });
    });
    const addEndpoint = (index, label, css, text) => {
      L.marker(route.points[index].position, {
        title: label, alt: label, keyboard: true,
        icon: L.divIcon({ className: `route-pin ${css}`, html: `<span>${text}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).addTo(map).bindTooltip(label).on('click', () => onSelectRecord(route.points[index].record));
    };
    addEndpoint(0, 'Start', 'route-pin-start', 'S');
    if (route.points.length > 1) addEndpoint(route.points.length - 1, 'Ziel', 'route-pin-finish', 'Z');
    cursorRef.current = L.circleMarker(route.points[0].position, { radius: 6, color: '#fff', weight: 2, fillColor: '#1b1a17', fillOpacity: 1, interactive: false }).addTo(map);
    fit();
    const resize = () => map.invalidateSize({ pan: false });
    const observer = window.ResizeObserver ? new ResizeObserver(resize) : null;
    observer?.observe(host.current);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      tiles.off();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      cursorRef.current = null;
      fitRef.current = null;
    };
  }, [route, visible, onSelectRecord]);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    // A missing GPS fix must not leave a marker at an unrelated recorded time.
    cursor.setStyle({ opacity: current ? 1 : 0, fillOpacity: current ? 1 : 0 });
    if (current) cursor.setLatLng(current.position);
  }, [current, visible, onSelectRecord]);
  useEffect(() => { mapRef.current?.invalidateSize({ pan: false }); }, [expanded]);

  if (!route.points.length) return <section className="activity-section route-empty"><h2>Strecke</h2><p>Diese Aktivität enthält keine GPS-Positionen. Eine Route kann deshalb nicht angezeigt werden.</p></section>;
  const goTo = index => {
    onSelectRecord(route.points[index].record);
    mapRef.current?.panTo(route.points[index].position);
  };
  const overview = () => {
    const map = mapRef.current;
    if (map) map.setView(L.latLngBounds(route.points.map(point => point.position)).getCenter(), 5);
  };

  return <section className="activity-section route-section" aria-label="GPS-Strecke">
    <div className="route-heading"><div><h2>Deine Strecke</h2><p>Entdecke die Orte und Straßen entlang deiner Aufzeichnung.</p></div>
      <div className="route-actions"><button type="button" onClick={() => fitRef.current?.()}>Gesamte Strecke</button><button type="button" onClick={overview}>Umgebung</button><button type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Karte verkleinern' : 'Karte vergrößern'}</button></div>
    </div>
    {tileError && <div className="route-map-error" role="status">Einige Kartenausschnitte konnten nicht geladen werden. Die GPS-Strecke bleibt sichtbar. <button type="button" onClick={() => { setTileError(false); tilesRef.current?.redraw(); }}>Erneut laden</button></div>}
    <div ref={host} className={`route-map ${expanded ? 'route-map-expanded' : ''}`} role="region" aria-label="OpenStreetMap mit aufgezeichneter Route" />
    <div className="route-legend"><button type="button" onClick={() => goTo(0)}><span className="route-dot route-start-dot" />Start anzeigen</button><button type="button" onClick={() => goTo(route.points.length - 1)}><span className="route-dot route-finish-dot" />Ziel anzeigen</button><span>{formatNumber(route.points.length, 0)} GPS-Punkte{route.segments.length > 1 ? ` · ${route.segments.length} Abschnitte` : ''}</span></div>
    <div className="route-point-details" aria-live="off">
      {[
        ['Zeit seit Start', formatTime(record.time)],
        ['Distanz', Number.isFinite(record.distance) ? `${formatNumber(record.distance / 1000, 2)} km` : '—'],
        ['Geschwindigkeit', Number.isFinite(record.speed) ? `${formatNumber(record.speed)} km/h` : '—'],
        ['Herzfrequenz', Number.isFinite(record.hr) ? `${record.hr} bpm` : '—'],
        ['Leistung', Number.isFinite(record.power) ? `${record.power} W` : '—'],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    {!current && <p className="route-help">Für diesen Zeitpunkt wurde keine GPS-Position aufgezeichnet.</p>}
    <p className="route-help">Bewege die Maus über ein Diagramm im Aktivitätsverlauf: Der Punkt auf der Karte folgt dem gewählten Zeitpunkt. Du kannst auch direkt auf die Strecke klicken.{route.segments.length > 1 ? ' Aufzeichnungslücken werden nicht durch Linien verbunden.' : ''}</p>
    <p className="route-provider">Kartenhintergrund: OpenStreetMap · benötigt Internet. Die Strecke wird aus deiner gespeicherten Aktivität im Browser gezeichnet.</p>
  </section>;
}
