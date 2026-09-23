const radians = value => value * Math.PI / 180;

export function validPosition(record) {
  return Number.isFinite(record.lat) && Number.isFinite(record.lng)
    && Math.abs(record.lat) <= 90 && Math.abs(record.lng) <= 180;
}

export function distanceMetres(a, b) {
  const lat = radians(b.lat - a.lat);
  const lng = radians(b.lng - a.lng);
  const value = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

export function buildRoute(records) {
  const points = [];
  const segments = [];
  let segment = [];
  let previous = null;
  let missing = 0;
  const finishSegment = () => { if (segment.length) segments.push(segment); segment = []; };
  records.forEach((record, recordIndex) => {
    if (!validPosition(record)) {
      missing += 1;
      finishSegment();
      previous = null;
      return;
    }
    // Unwrap longitudes across the date line so a short ride does not span the world.
    let longitude = record.lng;
    const last = points[points.length - 1];
    if (last) longitude += Math.round((last.position[1] - longitude) / 360) * 360;
    const point = { record, recordIndex, position: [record.lat, longitude] };
    if (previous) {
      const elapsed = Number.isFinite(record.time) && Number.isFinite(previous.record.time) ? record.time - previous.record.time : null;
      const distance = distanceMetres(previous.record, record);
      // Keep recording gaps and large jumps as separate lines, not imaginary roads.
      if ((elapsed != null && (elapsed < 0 || elapsed > 120)) || distance > 5000
          || (elapsed > 0 && distance > 200 && distance / elapsed > 100)) finishSegment();
    }
    points.push(point);
    segment.push(point.position);
    previous = point;
  });
  finishSegment();
  return { points, segments, missing };
}

export function nearestPointIndex(points, position) {
  let best = -1;
  let distance = Infinity;
  points.forEach((point, index) => {
    const candidate = distanceMetres(point.record, position);
    if (candidate < distance) { best = index; distance = candidate; }
  });
  return best;
}
