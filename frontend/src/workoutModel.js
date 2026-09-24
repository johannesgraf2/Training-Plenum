export const intensityLabels = { warmup: 'Aufwärmen', active: 'Aktiv', interval: 'Intervall', recovery: 'Erholung', cooldown: 'Abwärmen' };
export const targetLabels = { none: 'Kein Ziel', pace: 'Pace', speed: 'Geschwindigkeit', heart_rate: 'Herzfrequenz', power: 'Leistung', cadence: 'Kadenz' };
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// Format the selected calendar day directly, without timezone conversion.
export const garminWorkoutName = ({ date, name }) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && name.trim()
  ? `${date.split('-').reverse().join('.')} · ${name.trim()}` : '';
export const fitFileName = ({ date, name }) => `${date}_${name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_|_$/g, '') || 'workout'}.fit`;
export const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
export const newStep = (intensity = 'active', seconds = 300) => ({ kind: 'step', name: '', intensity, duration: { type: 'time', value: seconds }, target: { type: 'none' } });
export const powerStep = (intensity, seconds, watts) => ({ ...newStep(intensity, seconds), target: { type: 'power', low: watts, high: watts } });
export const newWorkout = date => ({ version: 1, name: '', sport: 'ride', date, steps: [powerStep('active', 1800, 180)] });
export const intervalBlock = (sport = 'ride') => ({ kind: 'repeat', count: 5, steps: sport === 'ride'
  ? [powerStep('interval', 240, 330), powerStep('recovery', 240, 120)]
  : [newStep('interval', 240), newStep('recovery', 240)] });
export const exampleWorkout = date => ({ version: 1, name: '5 × 1000 m Intervalle', sport: 'run', date, steps: [
  newStep('warmup', 900),
  { kind: 'repeat', count: 5, steps: [
    { kind: 'step', name: '1000 m zügig', intensity: 'interval', duration: { type: 'distance', value: 1000 }, target: { type: 'pace', low: 240, high: 250 } },
    newStep('recovery', 120),
  ] },
  newStep('cooldown', 600),
] });

export const runningIntervals = (date, distance, count, recoveryDistance) => ({
  version: 1, name: `${count} × ${distance >= 1000 ? `${distance / 1000} km` : `${distance} m`} Intervalle`, sport: 'run', date,
  steps: [
    { ...newStep('warmup'), duration: { type: 'distance', value: 2000 } },
    { kind: 'repeat', count, steps: [
      { ...newStep('interval'), duration: { type: 'distance', value: distance }, target: { type: 'pace', low: 240, high: 250 } },
      { ...newStep('recovery'), name: 'Trabpause', duration: { type: 'distance', value: recoveryDistance } },
    ] },
    { ...newStep('cooldown'), duration: { type: 'distance', value: 1000 } },
  ],
});

export function shortCyclingIntervals(date) {
  const steps = [powerStep('warmup', 600, 120)];
  for (let series = 1; series <= 3; series++) {
    // Three ordinary repeat blocks preserve series rests without requiring nested FIT repeats.
    steps.push({ kind: 'repeat', count: 7, steps: [
      { ...powerStep('interval', 40, 330), name: `Serie ${series} · Belastung` },
      { ...powerStep('recovery', 20, 120), name: `Serie ${series} · kurze Pause` },
    ] });
    if (series < 3) steps.push({ ...powerStep('recovery', 300, 120), name: 'Serienpause' });
  }
  steps.push(powerStep('cooldown', 600, 100));
  return { version: 1, name: '3 × 7 × 40/20 s', sport: 'ride', date, steps };
}

export const workoutTemplates = [
  { id: 'steady30', sport: 'ride', title: '30 min konstant', subtitle: '30 min · 180 W', bars: [4, 4, 4, 4, 4, 4],
    create: date => ({ ...newWorkout(date), name: '30 min konstant' }) },
  { id: 'intervals4', sport: 'ride', title: '4-min-Intervalle', subtitle: '5 × 4 min 330 W / 4 min 120 W', bars: [2, 6, 2, 6, 2, 6, 2, 2],
    create: date => ({ version: 1, name: '5 × 4 min · 330 W', sport: 'ride', date,
      steps: [powerStep('warmup', 600, 120), intervalBlock('ride'), powerStep('cooldown', 600, 100)] }) },
  { id: 'easy60', sport: 'ride', title: '60 min locker', subtitle: '60 min · 140 W', bars: [3, 3, 3, 3, 3, 3],
    create: date => ({ version: 1, name: '60 min locker', sport: 'ride', date, steps: [powerStep('active', 3600, 140)] }) },
  { id: 'short4020', sport: 'ride', title: '3 × 7 × 40/20 s', subtitle: '330 / 120 W · 5 min Serienpause', bars: [6, 2, 6, 2, 1, 6, 2, 6], create: shortCyclingIntervals },
  { id: 'run400', sport: 'run', title: '10 × 400 m', subtitle: '400 m zügig / 200 m Trabpause', bars: [5, 2, 5, 2, 5, 2, 5, 2], create: date => runningIntervals(date, 400, 10, 200) },
  { id: 'run1000', sport: 'run', title: '5 × 1 km', subtitle: '1 km zügig / 400 m Trabpause', bars: [5, 5, 2, 5, 5, 2], create: date => runningIntervals(date, 1000, 5, 400) },
  { id: 'run2000', sport: 'run', title: '3 × 2 km', subtitle: '2 km zügig / 600 m Trabpause', bars: [5, 5, 5, 2, 5, 5, 5, 2], create: date => runningIntervals(date, 2000, 3, 600) },
];

function mapSteps(steps, fn) {
  return steps.map(step => step.kind === 'repeat' ? { ...step, steps: step.steps.map(fn) } : fn(step));
}

export function toDraft(workout) {
  return { ...workout, steps: mapSteps(workout.steps, step => ({ ...step,
    duration: { ...step.duration, value: step.duration.type === 'time' ? clock(step.duration.value) : String(step.duration.value ?? '') },
    target: { ...step.target, ...(step.target.type === 'none' ? {} : {
      low: step.target.type === 'pace' ? clock(step.target.low) : String(step.target.low),
      high: step.target.type === 'pace' ? clock(step.target.high) : String(step.target.high),
      mode: step.target.low === step.target.high ? 'single' : 'range',
    }) },
  })) };
}

function timeValue(value, label) {
  if (!/^\d{1,4}(:[0-5]\d)?$/.test(String(value).trim())) throw new Error(`${label}: Bitte min:ss eingeben, z. B. 4:10.`);
  const [minutes, seconds = 0] = String(value).trim().split(':').map(Number);
  return minutes * 60 + seconds;
}

function numeric(value) {
  if (String(value).trim() === '') throw new Error('Bitte alle Dauer- und Zielwerte ausfüllen.');
  const number = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(number)) throw new Error('Bitte gültige Zahlen für Dauer und Zielbereich eingeben.');
  return number;
}

function repeatCount(value) {
  const count = numeric(value);
  if (!Number.isInteger(count) || count < 2 || count > 99) throw new Error('Bitte 2 bis 99 Wiederholungen eingeben.');
  return count;
}

export function toWorkout(draft) {
  return { version: 1, name: draft.name, sport: draft.sport, date: draft.date, steps: mapSteps(draft.steps, step => ({
    ...step,
    duration: step.duration.type === 'open' ? { type: 'open' } : { type: step.duration.type,
      value: step.duration.type === 'time' ? timeValue(step.duration.value, 'Dauer') : numeric(step.duration.value) },
    target: step.target.type === 'none' ? { type: 'none' } : { type: step.target.type,
      low: step.target.type === 'pace' ? timeValue(step.target.low, 'Pace') : numeric(step.target.low),
      high: step.target.type === 'pace' ? timeValue(step.target.high, 'Pace') : numeric(step.target.high) },
  })).map(step => step.kind === 'repeat' ? { ...step, count: repeatCount(step.count) } : step),
  ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}) };
}

export function workoutTotals(workout) {
  const totals = { time: 0, distance: 0, open: 0, fitSteps: 0 };
  workout.steps.forEach(block => {
    const steps = block.kind === 'repeat' ? block.steps : [block];
    const count = block.kind === 'repeat' ? Number(block.count) : 1;
    totals.fitSteps += steps.length + (block.kind === 'repeat' ? 1 : 0);
    steps.forEach(({ duration }) => {
      if (duration.type === 'open') totals.open += count;
      else totals[duration.type] += duration.value * count;
    });
  });
  return totals;
}

export function summary(workout) {
  const t = workoutTotals(workout);
  return [t.time > 0 && `${+(t.time / 60).toFixed(1)} min`, t.distance > 0 && `${+(t.distance / 1000).toFixed(2)} km`, t.open > 0 && `${t.open} offene Schritte`].filter(Boolean).join(' + ');
}

export function stepDescription(step) {
  const d = step.duration, t = step.target;
  const duration = d.type === 'open' ? 'Bis Lap-Taste' : d.type === 'time' ? `${clock(d.value)} min` : `${d.value} m`;
  if (t.type === 'none') return duration;
  const unit = { pace: '/km', speed: 'km/h', heart_rate: 'bpm', power: 'W', cadence: 'rpm' }[t.type];
  const format = value => t.type === 'pace' ? clock(value) : value;
  const range = t.low === t.high ? format(t.low) : `${format(t.low)}–${format(t.high)}`;
  return `${duration} · ${range} ${unit}`;
}

// Expand repeats for the overview only. The saved/exported model keeps repeat blocks.
export function workoutOverview(workout) {
  const segments = [];
  let time = 0, distance = 0, workTime = 0, recoveryTime = 0, workDistance = 0, recoveryDistance = 0, powerTime = 0, energy = 0;
  const add = (step, path, repetition = null) => {
    if (step.target.type !== 'none' && (!(step.target.low > 0) || !(step.target.high >= step.target.low))) throw new Error('Bitte gültige Zielwerte eingeben.');
    const seconds = step.duration.type === 'time' ? step.duration.value : null;
    const metres = step.duration.type === 'distance' ? step.duration.value : null;
    const power = step.target.type === 'power' ? (step.target.low + step.target.high) / 2 : null;
    if ((step.duration.type !== 'open' && !(step.duration.value > 0)) || (power !== null && !(power > 0))) throw new Error('Bitte positive Werte eingeben.');
    segments.push({ ...step, path, repetition, seconds, metres, power, start: time, end: time + (seconds || 0), startDistance: distance, endDistance: distance + (metres || 0) });
    time += seconds || 0;
    distance += metres || 0;
    if (['active', 'interval'].includes(step.intensity)) workTime += seconds || 0;
    if (['active', 'interval'].includes(step.intensity)) workDistance += metres || 0;
    if (step.intensity === 'recovery') recoveryTime += seconds || 0;
    if (step.intensity === 'recovery') recoveryDistance += metres || 0;
    if (power !== null && seconds !== null) { powerTime += seconds; energy += power * seconds; }
  };
  workout.steps.forEach((block, i) => {
    if (block.kind === 'repeat') {
      const count = repeatCount(block.count);
      for (let repeat = 1; repeat <= count; repeat++) block.steps.forEach((step, child) => add(step, `${i}.${child}`, repeat));
    } else add(block, String(i));
  });
  const allTimed = segments.length > 0 && segments.every(s => s.seconds !== null);
  const allDistance = segments.length > 0 && segments.every(s => s.metres !== null);
  const allPower = allTimed && segments.every(s => s.power !== null);
  return { segments, time, distance, workTime, recoveryTime, workDistance, recoveryDistance, allTimed, allDistance, allPower,
    averagePower: allPower && powerTime > 0 ? energy / powerTime : null };
}
