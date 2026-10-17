import { mainPace } from './workoutModel';

const step = (intensity, target) => ({ kind: 'step', name: '', intensity, duration: { type: 'time', value: 600 }, target });

test('the main pace of a run reads like 4:35–4:50 /km', () => {
  const warmup = step('warmup', { type: 'pace', low: 380, high: 410 });
  expect(mainPace({ steps: [warmup, step('active', { type: 'pace', low: 275, high: 290 }), warmup] })).toBe('4:35–4:50 /km');
  const repeat = { kind: 'repeat', count: 3, steps: [step('interval', { type: 'pace', low: 240, high: 240 }), step('recovery', { type: 'none' })] };
  expect(mainPace({ steps: [warmup, step('active', { type: 'pace', low: 300, high: 320 }), repeat] })).toBe('4:00 /km');
  expect(mainPace({ steps: [step('active', { type: 'heart_rate', low: 130, high: 145 })] })).toBeNull();
  expect(mainPace({ name: 'Ohne Schritte' })).toBeNull();
  expect(mainPace(undefined)).toBeNull();
});
