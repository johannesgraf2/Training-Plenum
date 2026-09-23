import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import L from 'leaflet';
import RouteMap from './RouteMap';
import ActivityDetail from './ActivityDetail';

jest.mock('leaflet', () => ({
  map: jest.fn(), tileLayer: jest.fn(), polyline: jest.fn(), marker: jest.fn(), circleMarker: jest.fn(),
  control: { scale: jest.fn() }, divIcon: jest.fn(), latLngBounds: jest.fn(),
}));

let host, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  const layer = () => ({ addTo: jest.fn().mockReturnThis(), on: jest.fn().mockReturnThis(), off: jest.fn(), bindTooltip: jest.fn().mockReturnThis(), setLatLng: jest.fn(), setStyle: jest.fn(), redraw: jest.fn() });
  L.map.mockImplementation(() => ({ zoomControl: { setPosition: jest.fn() }, fitBounds: jest.fn(), invalidateSize: jest.fn(), remove: jest.fn(), panTo: jest.fn(), setView: jest.fn() }));
  [L.tileLayer, L.polyline, L.marker, L.circleMarker, L.control.scale].forEach(mock => mock.mockImplementation(layer));
  L.divIcon.mockImplementation(value => value);
  L.latLngBounds.mockImplementation(() => ({ getCenter: () => ({ lat: 48, lng: 9 }) }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test('no GPS shows an honest empty state and makes no map requests', () => {
  act(() => root.render(<RouteMap data={[{ time: 0, hr: 120 }]} />));
  expect(host.textContent).toContain('keine GPS-Positionen');
  expect(L.map).not.toHaveBeenCalled();
  expect(L.tileLayer).not.toHaveBeenCalled();
});

test('route map follows the selected record without reinitializing and cleans up on navigation', () => {
  const data = [{ lat: 48, lng: 9, time: 0, speed: 0, hr: 120, power: 0 }, { lat: 48.001, lng: 9.001, time: 8, speed: 25.5, hr: 142, power: 210 }];
  act(() => root.render(<RouteMap data={data} />));
  const map = L.map.mock.results[0].value;
  const marker = L.circleMarker.mock.results[0].value;
  expect(L.tileLayer.mock.calls[0][0]).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  expect(L.tileLayer.mock.calls[0][1].attribution).toContain('openstreetmap.org/copyright');
  expect(host.textContent).toContain('0 W');
  act(() => root.render(<RouteMap data={data} selectedRecord={data[1]} />));
  expect(host.textContent).toContain('00:00:08');
  expect(host.textContent).toContain('142 bpm');
  expect(host.textContent).toContain('210 W');
  expect(marker.setLatLng).toHaveBeenLastCalledWith([48.001, 9.001]);
  expect(L.map).toHaveBeenCalledTimes(1);
  act(() => root.render(<RouteMap data={[]} />));
  expect(map.remove).toHaveBeenCalledTimes(1);
});

const activityWith = (timeSeries, id = 'ride') => ({ id, date: '2026-09-21T17:57:30Z', sport: 'ride', title: 'Test ride', timeSeries });
function hoverChart(label, time, maxTime = 100) {
  const chart = host.querySelector(`svg[aria-label="${label} über die verstrichene Zeit"]`);
  chart.getBoundingClientRect = () => ({ left: 100, width: 800 });
  act(() => Simulate.mouseMove(chart, { clientX: 100 + 40 + time / maxTime * 720 }));
  return chart;
}

test.each(['Herzfrequenz', 'Leistung', 'Geschwindigkeit', 'Kadenz', 'Höhe'])('%s hover moves the route marker by elapsed time and preserves map controls', label => {
  const data = [0, 8, 100].map((time, index) => ({ time, lat: 48 + index * 0.001, lng: 9 + index * 0.001, hr: 120 + index, power: index * 100, speed: index * 10, cadence: index * 40, elevation: 300 + index }));
  act(() => root.render(<ActivityDetail activity={activityWith(data)} />));
  const marker = L.circleMarker.mock.results[0].value;
  // 10% of the time axis is near the second record, not the first 10% of samples.
  const chart = hoverChart(label, 10);
  expect(marker.setLatLng).toHaveBeenLastCalledWith([48.001, 9.001]);
  expect(host.querySelector('.route-point-details').textContent).toContain('00:00:08');
  act(() => Simulate.mouseLeave(chart));
  expect(marker.setLatLng).toHaveBeenLastCalledWith([48.001, 9.001]);
  act(() => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Ziel anzeigen').click());
  expect(marker.setLatLng).toHaveBeenLastCalledWith([48.002, 9.002]);
  hoverChart(label, 0);
  expect(marker.setLatLng).toHaveBeenLastCalledWith([48, 9]);
  expect(host.querySelector('.route-point-details').textContent).toContain('0 W');
  expect(L.map).toHaveBeenCalledTimes(1);
});

test('hovering a missing GPS fix hides the marker until a recorded position is selected', () => {
  const data = [{ time: 0, hr: 120, lat: 48, lng: 9 }, { time: 50, hr: 130 }, { time: 100, hr: 140, lat: 48.001, lng: 9.001 }];
  act(() => root.render(<ActivityDetail activity={activityWith(data)} />));
  const marker = L.circleMarker.mock.results[0].value;
  hoverChart('Herzfrequenz', 50);
  expect(marker.setStyle).toHaveBeenLastCalledWith({ opacity: 0, fillOpacity: 0 });
  expect(host.querySelector('.route-point-details').textContent).toContain('00:00:50');
  expect(host.textContent).toContain('Für diesen Zeitpunkt wurde keine GPS-Position aufgezeichnet.');
  hoverChart('Herzfrequenz', 100);
  expect(marker.setStyle).toHaveBeenLastCalledWith({ opacity: 1, fillOpacity: 1 });
  expect(marker.setLatLng).toHaveBeenLastCalledWith([48.001, 9.001]);
});

test('switching activities clears the chart selection and starts the new route at its own first point', () => {
  act(() => root.render(<ActivityDetail activity={activityWith([{ time: 0, hr: 120, lat: 48, lng: 9 }, { time: 100, hr: 140, lat: 48.001, lng: 9.001 }])} />));
  const oldMap = L.map.mock.results[0].value;
  hoverChart('Herzfrequenz', 100);
  act(() => root.render(<ActivityDetail activity={activityWith([{ time: 0, hr: 80, lat: 49, lng: 10 }], 'new-ride')} />));
  expect(oldMap.remove).toHaveBeenCalledTimes(1);
  expect(L.circleMarker.mock.results[1].value.setLatLng).toHaveBeenLastCalledWith([49, 10]);
  expect(host.querySelector('.recording-chart-heading').textContent).toContain('80–80 bpm');
  expect(host.querySelector('.route-point-details').textContent).toContain('00:00:00');
});

test('tile failures leave the GPS view usable and offer a retry', () => {
  act(() => root.render(<RouteMap data={[{ lat: 48, lng: 9, time: 0 }]} />));
  const tiles = L.tileLayer.mock.results[0].value;
  const errorHandler = tiles.on.mock.calls.find(([event]) => event === 'tileerror')[1];
  act(() => errorHandler());
  expect(host.textContent).toContain('GPS-Strecke bleibt sichtbar');
  act(() => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Erneut laden').click());
  expect(tiles.redraw).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="status"]')).toBeNull();
});
