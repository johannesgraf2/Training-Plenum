import { buildRoute, distanceMetres, nearestPointIndex, validPosition } from './routeGeometry';

test('GPS requires two numeric coordinates and preserves valid zeros', () => {
  expect(validPosition({ lat: 0, lng: 0 })).toBe(true);
  for (const point of [{ lat: null, lng: 0 }, { lat: 48 }, { lat: NaN, lng: 9 }, { lat: 91, lng: 9 }, { lat: 48, lng: -181 }, { lat: '48', lng: 9 }]) expect(validPosition(point)).toBe(false);
});

test('missing GPS and pauses split the trace without losing original records', () => {
  const data = [{ lat: 48, lng: 9, time: 0, power: 0 }, { lat: 48.001, lng: 9, time: 5 }, { time: 6 }, { lat: 48.002, lng: 9, time: 7 }, { lat: 48.003, lng: 9, time: 300 }];
  const route = buildRoute(data);
  expect(route.points).toHaveLength(4);
  expect(route.segments.map(segment => segment.length)).toEqual([2, 1, 1]);
  expect(route.missing).toBe(1);
  expect(route.points[0].record.power).toBe(0);
  expect(route.points[3].recordIndex).toBe(4);
  expect(route.points[0].record).toBe(data[0]);
});

test('large jumps are never drawn as a travelled road', () => {
  const route = buildRoute([{ lat: 48, lng: 9, time: 0 }, { lat: 51, lng: 13, time: 1 }, { lat: 51.001, lng: 13, time: 2 }]);
  expect(route.segments.map(segment => segment.length)).toEqual([1, 2]);
});

test('a date-line crossing fits a local route rather than the entire globe', () => {
  const data = [{ lat: 0, lng: 179.99, time: 0 }, { lat: 0, lng: -179.99, time: 60 }];
  const route = buildRoute(data);
  expect(route.points[1].position[1]).toBeCloseTo(180.01);
  expect(data[1].lng).toBe(-179.99);
  expect(distanceMetres(data[0], data[1])).toBeCloseTo(2223.9, 0);
});

test('nearest point lookup and empty/single-position routes are well defined', () => {
  expect(buildRoute([]).points).toEqual([]);
  expect(nearestPointIndex([], { lat: 0, lng: 0 })).toBe(-1);
  const one = buildRoute([{ lat: 48, lng: 9 }]);
  expect(one.segments).toEqual([[[48, 9]]]);
  const route = buildRoute([{ lat: 48, lng: 9 }, { lat: 48.001, lng: 9 }, { lat: 48.002, lng: 9 }]);
  expect(nearestPointIndex(route.points, { lat: 48.0011, lng: 9 })).toBe(1);
});
