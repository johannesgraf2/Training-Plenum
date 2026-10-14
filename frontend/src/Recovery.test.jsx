import { dateRange, hrvBelowBand, hrvDeviation, isHard, planningHint, weekRecovery } from './Recovery';
import { powerStep } from './workoutModel';

const base = { mean: 60, low: 54, high: 66 };

test('HRV deviation and the normal range need a calibrated baseline', () => {
  expect(hrvDeviation({ hrv: 66, hrvBaseline: base })).toBe(10);
  expect(hrvDeviation({ hrv: 66, hrvBaseline: null })).toBeNull();
  expect(hrvBelowBand({ hrv: 50, hrvBaseline: base, confidence: 'provisional' })).toBe(true);
  expect(hrvBelowBand({ hrv: 50, hrvBaseline: base, confidence: 'calibrating' })).toBe(false);
});

test('only workouts with interval steps count as hard; broken definitions do not crash', () => {
  expect(isHard({ sport: 'ride', steps: [powerStep('interval', 300, 300)] })).toBe(true);
  expect(isHard({ sport: 'ride', steps: [powerStep('active', 3600, 180)] })).toBe(false);
  expect(isHard({ steps: null })).toBe(false);
});

test('no hint while calibrating or without a night', () => {
  const plan = [{ date: '2026-01-28', name: 'X', sport: 'ride', steps: [powerStep('interval', 300, 300)] }];
  expect(planningHint(undefined, '2026-01-28', plan)).toBeNull();
  expect(planningHint({ band: null, readiness: null, confidence: 'calibrating' }, '2026-01-28', plan)).toBeNull();
});

test('each hint carries a change request for the AI coach', () => {
  const hard = { date: '2026-01-28', name: 'VO2max 5 × 4', sport: 'ride', steps: [powerStep('interval', 300, 300)] };
  const night = extra => ({ readiness: 50, band: 'yellow', confidence: 'provisional', hrv: 66, hrvBaseline: base, ...extra });
  expect(planningHint(night({ readiness: 25, band: 'red' }), '2026-01-28', [hard]).coach)
    .toBe('Meine Readiness ist heute rot (25). Mach „VO2max 5 × 4“ (Mittwoch) bitte zu einer lockeren Einheit, oder tausche sie mit Donnerstag.');
  expect(planningHint(night({ readiness: 25, band: 'red' }), '2026-01-28', []).coach)
    .toBe('Meine Readiness ist heute rot (25). Plane heute und morgen nur lockere Einheiten.');
  expect(planningHint(night({ hrv: 50 }), '2026-01-28', [hard]).coach)
    .toBe('Meine HRV liegt heute unter meinem Normalbereich (50 ms, normal 54–66 ms). Reduziere die Intensität von „VO2max 5 × 4“ (Mittwoch), oder tausche sie mit Donnerstag.');
});

test('week averages over the nights that have values', () => {
  const days = { a: { readiness: 80, hrv: 66, hrvBaseline: base }, b: { readiness: 40, hrv: 54, hrvBaseline: base }, c: { readiness: null, hrv: null } };
  expect(weekRecovery(['a', 'b', 'c', 'd'], days)).toEqual({ readiness: 60, nights: 3, hrv: 60, hrvDeviation: 0 });
  expect(weekRecovery(['d'], days)).toBeNull();
});

test('date range ends today and crosses month ends', () => {
  expect(dateRange('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
});
