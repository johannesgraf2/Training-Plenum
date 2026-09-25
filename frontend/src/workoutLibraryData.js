// Example sessions for the workout builder. Cycling targets are fractions of FTP,
// running targets fractions of maximum heart rate, swimming targets seconds per 100 m
// relative to CSS; `create` turns them into a normal editable workout with watts / bpm
// for the current athlete (swimming without a target, the CSS offset is in the step name).
import { intensityZone, summary } from './workoutModel';

export const DEFAULT_FTP = 250;

// `terms` are search synonyms, so "threshold" or "base" find the German tags.
export const libraryTags = {
  vo2max: { label: 'VO2max', terms: ['vo2', 'hit', 'hiit', 'maximal'] },
  threshold: { label: 'Schwelle', terms: ['threshold', 'treshold', 'ftp', 'lt2', 'schwellen'] },
  sweetspot: { label: 'Sweetspot', terms: ['sweet spot', 'ss'] },
  overunder: { label: 'Over-Under', terms: ['over under', 'over/under', 'overunder', 'wechsel'] },
  tempo: { label: 'Tempo', terms: ['z3', 'tempodauerlauf', 'fahrtspiel', 'fartlek'] },
  base: { label: 'Grundlage', terms: ['base', 'endurance', 'ga1', 'z2', 'zone 2', 'grundlagenausdauer', 'lit', 'locker'] },
  long: { label: 'Lang', terms: ['long', 'langer lauf', 'lange ausfahrt'] },
  recovery: { label: 'Regeneration', terms: ['recovery', 'reko', 'easy', 'erholung'] },
  micro: { label: 'Mikrointervalle', terms: ['micro', 'microbursts', 'ronnestad', 'rønnestad'] },
  classic: { label: 'Klassische Intervalle', terms: ['klassisch', 'classic', 'konstant', 'steady'] },
  progressive: { label: 'Progressiv', terms: ['progressive', 'progression', 'steigernd', 'negative split'] },
  variable: { label: 'Variable Intervalle', terms: ['variabel', 'variable', 'wechselnd'] },
  sprint: { label: 'Sprint', terms: ['neuromuskulär', 'strides', 'steigerungen', 'steigerungsläufe'] },
  anaerobic: { label: 'Anaerob', terms: ['anaerobic', 'sit', 'z6', 'laktat'] },
  cadence: { label: 'Kadenz', terms: ['cadence', 'high cadence', 'trittfrequenz', 'rpm', 'hohe kadenz'] },
  strength: { label: 'Kraftausdauer', terms: ['k3', 'low cadence', 'kraft', 'berg', 'hill', 'hügel'] },
  race: { label: 'Rennvorbereitung', terms: ['opener', 'aktivierung', 'race', 'wettkampf', 'vorbelastung'] },
  technique: { label: 'Technik', terms: ['technique', 'drills', 'lauf-abc', 'abc', 'technikübungen', 'beinschlag', 'kick', 'atmung'] },
  test: { label: 'Test', terms: ['ftp-test', 'leistungstest', 'field test', 'css-test'] },
};

export const libraryPhases = {
  start: { label: 'Block-Start', terms: ['start', 'anfang', 'einstieg', 'beginn', 'early'] },
  mid: { label: 'Block-Mitte', terms: ['mitte', 'mid', 'middle'] },
  end: { label: 'Block-Ende', terms: ['ende', 'end', 'late', 'peak', 'höhepunkt'] },
};

const min = minutes => minutes * 60;
// duration: seconds, or { m: metres }; target: fraction, [low, high] or null (no target).
const step = (intensity, duration, target, name = '') => ({ intensity, duration, target, name });
const reps = (count, ...steps) => ({ repeat: count, steps });
const rename = (item, prefix) => item.repeat
  ? { ...item, steps: item.steps.map(s => rename(s, prefix)) } : { ...item, name: `${prefix} · ${item.name}` };
// Series of short repeats: one repeat block per series, so the FIT file needs no nested repeats.
// `items` is a repeat block or a list of steps/blocks forming one series; rests only between series.
const series = (count, items, rest, label = 'Serie') => Array.from({ length: count }, (_, index) => [
  ...[].concat(items).map(item => rename(item, `${label} ${index + 1}`)),
  ...(index < count - 1 ? [rest] : []),
]).flat();

const warm = (minutes = 15) => step('warmup', min(minutes), 0.6, 'Einfahren');
const cool = (minutes = 10) => step('cooldown', min(minutes), 0.5, 'Ausfahren');
const spin = (seconds, name = 'Locker kurbeln') => step('recovery', seconds, 0.5, name);
const runWarm = (minutes = 15) => step('warmup', min(minutes), [0.65, 0.75], 'Einlaufen');
const runCool = (minutes = 10) => step('cooldown', min(minutes), [0.6, 0.72], 'Auslaufen');
const jog = (duration, name = 'Trabpause') => step('recovery', duration, null, name);
const easy = (duration, name = 'Locker') => step('active', duration, [0.65, 0.75], name);

const family = (key, sport, familyTitle, tags, note, variants) => variants.map(([phase, title, spec, description]) =>
  ({ id: `${key}-${phase}`, family: key, familyTitle, note, sport, phase, title, tags, description, spec }));
const single = (id, sport, title, tags, spec, description) => ({ id, sport, title, tags, description, spec });

const PHASES = ['start', 'mid', 'end'];
const PYRAMID = { 1: 1.25, 2: 1.2, 3: 1.15, 4: 1.1, 5: 1.1 };
const percent = fraction => `${Math.round(fraction * 100)} %`;
const clockText = seconds => seconds % 60 ? `${seconds} s` : `${seconds / 60} min`;
// Minutes as "90 min", "2 h" or "2:30 h".
const durationText = minutes => minutes < 120 ? `${minutes} min` : minutes % 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h` : `${minutes / 60} h`;

// Short work/rest repeats in series with 5 min series rest, e.g. 3 × 8 × 30/15 s.
const microFamily = (key, familyTitle, work, rest, target, variants) => family(key, 'ride', familyTitle, ['vo2max', 'micro'],
  `Serien aus ${work} s hart (~${percent(target)} FTP) / ${rest} s locker, 5 min Serienpause.`,
  variants.map(([phase, sets, count]) => [phase, `${sets} × ${count} × ${work}/${rest} s`,
    [warm(), ...series(sets, reps(count, step('interval', work, target, 'Belastung'), step('recovery', rest, 0.5, 'Pause')), spin(min(5), 'Serienpause')), cool()],
    `${libraryPhases[phase].label} ${work}/${rest}: ${sets} Serien à ${count} × ${work} s bei ~${percent(target)} FTP / ${rest} s locker, 5 min Serienpause.`]));

// Classic intervals with a fixed easy recovery; the number of repetitions rises over the block.
const classicFamily = (key, familyTitle, work, rest, target, counts, title = (n, name) => `${n} × ${clockText(work)} ${name}`) =>
  family(key, 'ride', familyTitle, ['vo2max', 'classic'], `${clockText(work)} bei ~${percent(target)} FTP, ${clockText(rest)} locker. Anzahl steigt über den Block.`,
    counts.map((n, i) => [PHASES[i], title(n, 'VO2max'), [warm(), reps(n, step('interval', work, target, 'VO2max'), spin(rest)), cool()],
      `${libraryPhases[PHASES[i]].label} ${familyTitle}: ${n} × ${clockText(work)} bei ~${percent(target)} FTP, ${clockText(rest)} locker.`]));

const targetText = target => Array.isArray(target) ? `${Math.round(target[0] * 100)}–${Math.round(target[1] * 100)} %` : `~${percent(target)}`;
const STAIRS = { 5: 1.02, 10: 1, 15: 0.98, 20: 0.97, 25: 0.95 };

// Single intervals of their own length and target, `rest` easy spinning between them.
const ladder = (intervals, rest = min(5)) => intervals.flatMap(([minutes, target, name], index) =>
  [step('interval', min(minutes), target, name), ...(index < intervals.length - 1 ? [spin(rest)] : [])]);

// Fills `seconds` with a repeating [seconds, target, name] pattern; the last round is cut off where the time ends.
function cycle(seconds, pattern) {
  const round = pattern.reduce((sum, [length]) => sum + length, 0);
  const rounds = Math.floor(seconds / round);
  const steps = pattern.map(([length, target, name]) => step('interval', length, target, name));
  let left = seconds - rounds * round;
  const tail = pattern.flatMap(([length, target, name]) => {
    const part = Math.min(length, left);
    left -= part;
    return part > 0 ? [step('interval', part, target, name)] : [];
  });
  return [...(rounds > 1 ? [reps(rounds, ...steps)] : rounds ? steps : []), ...tail];
}

// Steady threshold intervals; `variants` are [count, minutes, target, easy minutes = 5] for start, middle and end.
const steadyFamily = (key, familyTitle, tags, note, variants, name = 'Schwelle') => family(key, 'ride', familyTitle, tags, note,
  variants.map(([n, minutes, target, rest = 5], i) => [PHASES[i], `${n} × ${minutes} min ${name}`,
    [warm(), reps(n, step('interval', min(minutes), target, name), spin(min(rest))), cool()],
    `${libraryPhases[PHASES[i]].label} ${familyTitle}: ${n} × ${minutes} min bei ${targetText(target)} FTP, ${rest} min locker.`]));

// Intervals built from a repeating pattern (or `pattern(minutes)`), 5 min easy; `variants` are [count, minutes].
const patternFamily = (key, familyTitle, tags, note, pattern, variants, name, detail) => family(key, 'ride', familyTitle, tags, note,
  variants.map(([n, minutes], i) => [PHASES[i], `${n} × ${minutes} min ${name}`,
    [warm(), ...series(n, cycle(min(minutes), typeof pattern === 'function' ? pattern(minutes) : pattern), spin(min(5)), 'Intervall'), cool()],
    `${libraryPhases[PHASES[i]].label} ${familyTitle}: ${n} × ${minutes} min, ${detail}, 5 min locker.`]));

const rideLibrary = [
  ...family('ride-vo2-4', 'ride', 'VO2max 4 min', ['vo2max', 'classic'], '4-min-Intervalle bei ~115 % FTP, 4 min locker. Umfang steigt über den Block.', [
    ['start', '3 × 4 min VO2max', [warm(), reps(3, step('interval', min(4), 1.15, 'VO2max'), spin(min(4))), cool()],
      'Block-Start VO2max: 3 × 4 min bei ~115 % FTP. Gleichmäßig fahren, die letzte Wiederholung soll noch sauber gelingen.'],
    ['mid', '4 × 4 min VO2max', [warm(), reps(4, step('interval', min(4), 1.15, 'VO2max'), spin(min(4))), cool()],
      'Block-Mitte VO2max: 4 × 4 min bei ~115 % FTP. Eine Wiederholung mehr bei gleicher Leistung.'],
    ['end', '6 × 4 min VO2max', [warm(), reps(6, step('interval', min(4), 1.15, 'VO2max'), spin(min(4))), cool()],
      'Block-Ende VO2max: 6 × 4 min bei ~115 % FTP. Höchster Umfang im Block; bei Leistungsabfall eher Watt als Wiederholungen streichen.'],
  ]),
  ...microFamily('ride-vo2-3015', 'VO2max 30/15', 30, 15, 1.25, [['start', 3, 6], ['mid', 3, 8], ['end', 3, 11]]),
  ...microFamily('ride-vo2-4020', 'VO2max 40/20', 40, 20, 1.2, [['start', 3, 6], ['mid', 3, 8], ['end', 3, 11]]),
  ...microFamily('ride-vo2-4515', 'VO2max 45/15', 45, 15, 1.24, [['start', 3, 6], ['mid', 3, 8], ['end', 3, 10]]),
  ...microFamily('ride-vo2-2010', 'VO2max 20/10', 20, 10, 1.4, [['start', 3, 8], ['mid', 3, 10], ['end', 3, 15]]),
  ...microFamily('ride-vo2-1515', 'VO2max 15/15', 15, 15, 1.4, [['start', 3, 12], ['mid', 3, 15], ['end', 3, 20]]),
  ...classicFamily('ride-vo2-3', 'VO2max 3 min', min(3), min(3), 1.2, [4, 5, 6]),
  ...classicFamily('ride-vo2-5', 'VO2max 5 min', min(5), min(5), 1.12, [3, 4, 5]),
  ...classicFamily('ride-vo2-6', 'VO2max 6 min', min(6), min(5), 1.08, [3, 4, 5]),
  ...classicFamily('ride-vo2-11', 'VO2max 1/1', min(1), min(1), 1.3, [10, 12, 15], (n, name) => `${n} × 1 min / 1 min ${name}`),
  ...classicFamily('ride-vo2-9090', 'VO2max 90/90', 90, 90, 1.24, [6, 8, 10], (n, name) => `${n} × 90 s / 90 s ${name}`),
  ...family('ride-hardstart-4', 'ride', 'Hard Start 4 min', ['vo2max', 'variable'], 'Die ersten 30 s deutlich überziehen (~135 % FTP), dann 3:30 min bei ~112 % FTP halten. 4 min locker.',
    [4, 5, 6].map((n, i) => [PHASES[i], `${n} × 4 min Hard Start`,
      [warm(), reps(n, step('interval', 30, 1.35, 'Hard Start'), step('interval', 210, 1.12, 'VO2max halten'), spin(min(4))), cool()],
      `${libraryPhases[PHASES[i]].label} Hard Start: ${n} × 4 min, davon 30 s bei ~135 % und 3:30 min bei ~112 % FTP, 4 min locker.`])),
  ...family('ride-hardstart-5', 'ride', 'Hard Start 5 min', ['vo2max', 'variable'], 'Längere Variante für Fortgeschrittene: 45 s sehr hart, dann 4:15 min kontrolliert hart. 5 min locker.',
    [3, 4, 5].map((n, i) => [PHASES[i], `${n} × 5 min Hard Start`,
      [warm(), reps(n, step('interval', 45, 1.35, 'Hard Start'), step('interval', 255, 1.1, 'Kontrolliert hart'), spin(min(5))), cool()],
      `${libraryPhases[PHASES[i]].label} Hard Start: ${n} × 5 min, davon 45 s bei ~135 % und 4:15 min bei ~110 % FTP, 5 min locker.`])),
  ...family('ride-vo2-overunder', 'ride', 'Over/Under VO2max', ['vo2max', 'variable', 'overunder'], 'Im Intervall 30 s bei ~125 % und 30 s bei ~110 % FTP im Wechsel, 4 min locker.',
    [[3, 5], [3, 6], [4, 6]].map(([n, minutes], i) => [PHASES[i], `${n} × ${minutes} min Over/Under VO2max`,
      [warm(), ...series(n, reps(minutes, step('interval', 30, 1.25, 'Over'), step('interval', 30, 1.1, 'Under')), spin(min(4)), 'Intervall'), cool()],
      `${libraryPhases[PHASES[i]].label} Over/Under VO2max: ${n} × ${minutes} min im Wechsel 30 s ~125 % / 30 s ~110 % FTP, 4 min locker.`])),
  ...family('ride-vo2-waves', 'ride', 'VO2max Waves', ['vo2max', 'variable'], 'Lange Intervalle in Wellen: 1 min ~120 % / 1 min ~110 % FTP im Wechsel, 4 min locker.',
    [[3, 6], [4, 6], [4, 7]].map(([n, minutes], i) => [PHASES[i], `${n} × ${minutes} min Waves`,
      [warm(), ...series(n, [reps(Math.floor(minutes / 2), step('interval', min(1), 1.2, 'Welle hoch'), step('interval', min(1), 1.1, 'Welle tief')),
        ...(minutes % 2 ? [step('interval', min(1), 1.2, 'Welle hoch')] : [])], spin(min(4)), 'Intervall'), cool()],
      `${libraryPhases[PHASES[i]].label} Waves: ${n} × ${minutes} min, 1 min ~120 % / 1 min ~110 % FTP im Wechsel, 4 min locker.`])),
  ...family('ride-vo2-pyramid', 'ride', 'VO2max-Pyramide', ['vo2max', 'variable'], 'Stufen von 1 bis 5 min, kurze Stufen härter (bis ~125 % FTP). Pause so lang wie die Stufe davor.',
    [[1, 2, 3, 2, 1], [1, 2, 3, 4, 3, 2, 1], [2, 3, 4, 5, 4, 3, 2]].map((stairs, i) => [PHASES[i], `VO2max-Pyramide ${stairs.join('-')}`,
      [warm(), ...stairs.flatMap((minutes, index) => [step('interval', min(minutes), PYRAMID[minutes], `${minutes} min`), ...(index < stairs.length - 1 ? [spin(min(minutes))] : [])]), cool()],
      `${libraryPhases[PHASES[i]].label} Pyramide ${stairs.join('-')} min: 1 min ~125 %, 2 min ~120 %, 3 min ~115 %, 4–5 min ~110 % FTP. Pause so lang wie die Stufe davor.`])),
  ...family('ride-vo2-321', 'ride', 'VO2max 3-2-1', ['vo2max', 'variable'], 'Blöcke aus 3 + 2 + 1 min mit steigender Leistung (~112 → 118 → 125 % FTP), 5 min locker.',
    [2, 3, 4].map((n, i) => [PHASES[i], `${n} × (3 + 2 + 1 min)`,
      [warm(), reps(n, step('interval', min(3), 1.12, '3 min'), step('interval', min(2), 1.18, '2 min'), step('interval', min(1), 1.25, '1 min'), spin(min(5))), cool()],
      `${libraryPhases[PHASES[i]].label} 3-2-1: ${n} Blöcke aus 3 min ~112 %, 2 min ~118 % und 1 min ~125 % FTP ohne Pause, 5 min locker.`])),
  ...family('ride-vo2-attack', 'ride', 'Attack-VO2max', ['vo2max', 'variable', 'race'], 'Rennähnlich: 15 s Attacke (~160 % FTP), dann 3:45 min hart halten. 4 min locker.',
    [4, 5, 6].map((n, i) => [PHASES[i], `${n} × 4 min Attack-VO2max`,
      [warm(), reps(n, step('interval', 15, 1.6, 'Attacke'), step('interval', 225, 1.12, 'Hart halten'), spin(min(4))), cool()],
      `${libraryPhases[PHASES[i]].label} Attack-VO2max: ${n} × 4 min, 15 s Attacke ~160 % FTP, dann 3:45 min ~112 % FTP, 4 min locker.`])),
  ...steadyFamily('ride-threshold-10', 'Schwelle 10 min', ['threshold', 'classic'], 'Kurze Schwellenintervalle um ~100 % FTP, 5 min locker. Die Anzahl steigt über den Block.',
    [[3, 10, 1], [4, 10, 1], [5, 10, 1]]),
  ...steadyFamily('ride-threshold-12', 'Schwelle 12 min', ['threshold', 'classic'], '12-min-Intervalle bei 98–100 % FTP, 5 min locker. Die Anzahl steigt über den Block.',
    [[3, 12, [0.98, 1]], [4, 12, [0.98, 1]], [5, 12, [0.98, 1]]]),
  ...steadyFamily('ride-threshold-15', 'Schwelle 15 min', ['threshold', 'classic'], 'Längere Intervalle knapp um FTP, 5 min locker. Bei mehr Umfang etwas defensiver starten.',
    [[2, 15, 1], [3, 15, [0.98, 1]], [4, 15, [0.95, 1]]]),
  ...steadyFamily('ride-threshold-20', 'Schwelle 20 min', ['threshold', 'classic'], 'Klassische lange FTP-Intervalle bei 95–100 % FTP. Erst eine Wiederholung mehr, am Ende kürzere Pausen (3 statt 5 min).',
    [[2, 20, [0.95, 1]], [3, 20, [0.95, 1]], [3, 20, [0.95, 1], 3]]),
  ...steadyFamily('ride-threshold-long', 'Schwelle lang', ['threshold', 'classic'], 'Sehr lange Intervalle bei 95–98 % FTP, 5 min locker. Gleichmäßig einteilen und verpflegen.',
    [[2, 25, [0.95, 0.98]], [2, 30, [0.95, 0.98]], [3, 25, [0.95, 0.98]]]),
  ...patternFamily('ride-overunder', 'Over-Under 2/1', ['threshold', 'variable', 'overunder'], 'Im Wechsel 2 min knapp unter / 1 min über FTP, 5 min locker.',
    [[120, 0.95, 'Under'], [60, 1.05, 'Over']], [[3, 10], [3, 12], [3, 15]], 'Over-Under 2/1', '2 min ~95 % / 1 min ~105 % FTP im Wechsel'),
  ...patternFamily('ride-overunder-31', 'Over-Under 3/1', ['threshold', 'overunder'], 'Kontrollierter: 3 min bei ~95 % / 1 min bei ~105 % FTP im Wechsel, 5 min locker.',
    [[180, 0.95, 'Under'], [60, 1.05, 'Over']], [[3, 12], [3, 16], [3, 20]], 'Over-Under 3/1', '3 min ~95 % / 1 min ~105 % FTP im Wechsel'),
  ...patternFamily('ride-overunder-hard', 'Over-Under aggressiv', ['threshold', 'overunder', 'race'], 'Stärkere Schwankungen: 1 min ~110 % / 2 min ~95 % FTP im Wechsel, 5 min locker. Wie im Rennen oder am Anstieg.',
    [[60, 1.1, 'Over'], [120, 0.95, 'Under']], [[3, 9], [3, 12], [3, 15]], 'Over-Under aggressiv', '1 min ~110 % / 2 min ~95 % FTP im Wechsel'),
  ...patternFamily('ride-threshold-waves', 'Schwellen-Waves', ['threshold', 'variable'], 'Langsame Leistungswellen: je 2 min bei ~95, ~100 und ~105 % FTP, 5 min locker.',
    [[120, 0.95, 'Welle tief'], [120, 1, 'Welle mittel'], [120, 1.05, 'Welle hoch']], [[3, 12], [3, 15], [3, 20]], 'Schwellen-Waves', 'je 2 min ~95 / ~100 / ~105 % FTP in Wellen'),
  ...patternFamily('ride-threshold-3030', 'Schwelle 30/30', ['threshold', 'variable'], 'Kontrollierte 30/30 rund um FTP: 30 s ~105 % / 30 s ~95 %, keine echte Erholung. 5 min locker.',
    [[30, 1.05, 'Over'], [30, 0.95, 'Under']], [[3, 10], [3, 12], [3, 15]], 'Schwelle 30/30', '30 s ~105 % / 30 s ~95 % FTP im Wechsel'),
  ...patternFamily('ride-threshold-21', 'Schwelle 2/1', ['threshold', 'variable'], '2 min bei 100–102 % / 1 min bei 90–95 % FTP, die Leistung fällt nie in den Erholungsbereich. 5 min locker.',
    [[120, [1, 1.02], 'Schwelle'], [60, [0.9, 0.95], 'Etwas leichter']], [[3, 12], [3, 15], [3, 18]], 'Schwelle 2/1', '2 min 100–102 % / 1 min 90–95 % FTP im Wechsel'),
  ...patternFamily('ride-threshold-progressive', 'Progressive Schwelle', ['threshold', 'progressive'], 'Jedes Intervall in drei gleich langen Stufen bei ~95, ~100 und ~105 % FTP, 5 min locker.',
    minutes => [[minutes * 20, 0.95, 'Stufe 95 %'], [minutes * 20, 1, 'Stufe 100 %'], [minutes * 20, 1.05, 'Stufe 105 %']], [[3, 10], [3, 12], [3, 15]], 'progressiv', 'je Drittel ~95 → 100 → 105 % FTP'),
  ...family('ride-threshold-negsplit', 'ride', 'Schwelle Negative Split', ['threshold', 'progressive'], 'Die Intervalle werden innerhalb der Einheit härter, 5 min locker.',
    [[12, [0.95, 0.98, 1.01]], [15, [0.95, 1, 1.03]], [20, [0.95, 1, 1.03]]].map(([minutes, targets], i) => [PHASES[i], `3 × ${minutes} min Negative Split`,
      [warm(), ...ladder(targets.map((target, index) => [minutes, target, `Intervall ${index + 1}`])), cool()],
      `${libraryPhases[PHASES[i]].label} Negative Split: 3 × ${minutes} min bei ${targets.map(percent).join(' → ')} FTP, 5 min locker.`])),
  ...family('ride-threshold-pyramid', 'ride', 'Schwellen-Pyramide', ['threshold', 'variable'], 'Schwellenintervalle als Pyramide bei ~97 % FTP, 5 min locker dazwischen.',
    [[10, 15, 10], [10, 15, 20, 15, 10], [15, 20, 25, 20]].map((stairs, i) => [PHASES[i], `Schwellen-Pyramide ${stairs.join('-')}`,
      [warm(), ...ladder(stairs.map(minutes => [minutes, 0.97, `${minutes} min`])), cool()],
      `${libraryPhases[PHASES[i]].label} Pyramide ${stairs.join('-')} min bei ~97 % FTP, 5 min locker dazwischen.`])),
  ...family('ride-threshold-51015', 'ride', 'Stufenpyramide 5-10-15', ['threshold', 'variable'], 'Kompakte Pyramide, Intensität nach Länge: 5 min ~102 %, 10 min ~100 %, 15 min ~98 %, 20 min ~97 %, 25 min ~95 % FTP.',
    [[5, 10, 15, 10, 5], [10, 15, 20, 15, 10], [15, 20, 25, 20, 15]].map((stairs, i) => [PHASES[i], `Stufenpyramide ${stairs.join('-')}`,
      [warm(), ...ladder(stairs.map(minutes => [minutes, STAIRS[minutes], `${minutes} min`])), cool()],
      `${libraryPhases[PHASES[i]].label} Stufenpyramide ${stairs.join('-')} min bei 95–102 % FTP (kürzere Stufen härter), 5 min locker dazwischen.`])),
  ...family('ride-threshold-broken', 'ride', 'Broken Threshold', ['threshold', 'variable'], 'Schwellenblöcke aus drei Abschnitten bei ~100 % FTP mit je 30 s locker, 5 min Pause zwischen den Blöcken.',
    [[2, 5], [3, 5], [3, 6]].map(([n, minutes], i) => [PHASES[i], `${n} × (${minutes} + ${minutes} + ${minutes} min) Broken`,
      [warm(), ...series(n, [reps(2, step('interval', min(minutes), 1, 'Schwelle'), spin(30, 'Kurz locker')), step('interval', min(minutes), 1, 'Schwelle')], spin(min(5)), 'Block'), cool()],
      `${libraryPhases[PHASES[i]].label} Broken Threshold: ${n} Blöcke aus 3 × ${minutes} min bei ~100 % FTP mit 30 s locker, 5 min zwischen den Blöcken.`])),
  ...patternFamily('ride-threshold-attack', 'Attack-Schwelle', ['threshold', 'race'], 'Jedes Intervall beginnt mit 15 s Attacke (130–150 % FTP), danach bei 95–100 % FTP weiter Druck fahren. 5 min locker.',
    minutes => [[15, [1.3, 1.5], 'Attacke'], [minutes * 60 - 15, [0.95, 1], 'Schwelle halten']], [[3, 12], [3, 15], [3, 20]], 'Attack-Schwelle', '15 s Attacke 130–150 %, dann 95–100 % FTP'),
  ...patternFamily('ride-threshold-finish', 'Schwelle mit Finish', ['threshold', 'race'], 'Schwellenintervall bei ~97 % FTP mit hartem Ende: letzte Minute ~115 % FTP. 5 min locker.',
    minutes => [[min(minutes - 1), 0.97, 'Schwelle'], [60, 1.15, 'Finish']], [[2, 15], [3, 15], [3, 20]], 'Schwelle mit Finish', 'bei ~97 % FTP, letzte Minute ~115 %'),
  ...steadyFamily('ride-threshold-lowcad', 'Schwelle niedrige Kadenz', ['threshold', 'strength'], 'Schwelle bei 95–100 % FTP mit 60–75 rpm, 5 min locker. Oberkörper ruhig halten.',
    [[3, 10, [0.95, 1]], [3, 15, [0.95, 1]], [3, 20, [0.95, 1]]], 'Schwelle · 60–75 rpm'),
  ...steadyFamily('ride-threshold-highcad', 'Schwelle hohe Kadenz', ['threshold', 'cadence'], 'Schwelle bei 95–100 % FTP mit 100–110 rpm, 5 min locker. Rund treten, nicht hüpfen.',
    [[3, 10, [0.95, 1]], [3, 12, [0.95, 1]], [3, 15, [0.95, 1]]], 'Schwelle · 100–110 rpm'),
  ...patternFamily('ride-threshold-cadwaves', 'Kadenz-Waves an der Schwelle', ['threshold', 'cadence', 'variable'], 'Leistung bleibt bei 95–100 % FTP, die Kadenz wechselt: 2 min 85 / 2 min 100 / 2 min 90 rpm. 5 min locker.',
    [[120, [0.95, 1], '85 rpm'], [120, [0.95, 1], '100 rpm'], [120, [0.95, 1], '90 rpm']], [[3, 12], [3, 15], [3, 20]], 'Kadenz-Waves', 'bei 95–100 % FTP, Kadenz 85 / 100 / 90 rpm je 2 min'),
  ...family('ride-sweetspot', 'ride', 'Sweetspot', ['sweetspot'], 'Intervalle bei ~90 % FTP, 5 min locker. Intervalldauer steigt.', [
    ['start', '3 × 12 min Sweetspot', [warm(), reps(3, step('interval', min(12), 0.9, 'Sweetspot'), spin(min(5))), cool()],
      'Block-Start Sweetspot: 3 × 12 min bei ~90 % FTP, 5 min locker.'],
    ['mid', '3 × 15 min Sweetspot', [warm(), reps(3, step('interval', min(15), 0.9, 'Sweetspot'), spin(min(5))), cool()],
      'Block-Mitte Sweetspot: 3 × 15 min bei ~90 % FTP, 5 min locker.'],
    ['end', '3 × 20 min Sweetspot', [warm(), reps(3, step('interval', min(20), 0.9, 'Sweetspot'), spin(min(5))), cool()],
      'Block-Ende Sweetspot: 3 × 20 min bei ~90 % FTP, 5 min locker. Auf Verpflegung achten.'],
  ]),
  ...family('ride-sweetspot-long', 'ride', 'Sweetspot am Stück', ['sweetspot', 'classic', 'long'], 'Ein langes Intervall ohne Pause bei ~88 % FTP. Dauer steigt über den Block.',
    [30, 45, 60].map((minutes, i) => [PHASES[i], `${minutes} min Sweetspot am Stück`,
      [warm(), step('interval', min(minutes), 0.88, 'Sweetspot'), cool()],
      `${libraryPhases[PHASES[i]].label} Sweetspot am Stück: ${minutes} min bei ~88 % FTP ohne Pause. Gleichmäßig einteilen, Kopf und Verpflegung trainieren.`])),
  ...patternFamily('ride-sweetspot-progressive', 'Sweetspot Progressiv', ['sweetspot', 'progressive'], 'Jedes Intervall in drei gleich langen Stufen bei ~87, ~90 und ~93 % FTP, 5 min locker.',
    minutes => [[minutes * 20, 0.87, 'Stufe 87 %'], [minutes * 20, 0.9, 'Stufe 90 %'], [minutes * 20, 0.93, 'Stufe 93 %']], [[3, 12], [3, 15], [3, 18]], 'Sweetspot progressiv', 'je Drittel ~87 → 90 → 93 % FTP'),
  ...patternFamily('ride-sweetspot-bursts', 'Sweetspot mit Antritten', ['sweetspot', 'variable', 'race'], 'Grundlast bei ~90 % FTP, alle 2 min 10 s Antritt bei ~150 % FTP, danach sofort weiter Druck. 5 min locker.',
    [[110, 0.9, 'Sweetspot'], [10, 1.5, 'Antritt']], [[3, 12], [3, 15], [3, 20]], 'Sweetspot mit Antritten', '~90 % FTP mit 10 s Antritt ~150 % alle 2 min'),
  ...steadyFamily('ride-sweetspot-lowcad', 'Sweetspot Low Cadence', ['sweetspot', 'strength', 'cadence'], 'Sweetspot bei ~88 % FTP mit 60–70 rpm, 4 min locker mit hoher Kadenz. Oberkörper ruhig halten.',
    [[4, 8, 0.88, 4], [4, 10, 0.88, 4], [4, 12, 0.88, 4]], 'Sweetspot · 60–70 rpm'),
  ...family('ride-sweetspot-pyramid', 'ride', 'Sweetspot-Pyramide', ['sweetspot', 'variable'], 'Das mittlere Intervall ist das längste, alles bei ~90 % FTP, 5 min locker dazwischen.',
    [[10, 15, 10], [12, 18, 12], [15, 20, 15]].map((stairs, i) => [PHASES[i], `Sweetspot-Pyramide ${stairs.join('-')}`,
      [warm(), ...ladder(stairs.map(minutes => [minutes, 0.9, `${minutes} min`])), cool()],
      `${libraryPhases[PHASES[i]].label} Sweetspot-Pyramide ${stairs.join('-')} min bei ~90 % FTP, 5 min locker dazwischen.`])),
  ...patternFamily('ride-sweetspot-overunder', 'Sweetspot Over-Under', ['sweetspot', 'overunder'], 'Sanfte Vorstufe zu Over-Unders an der Schwelle: 2 min ~88 % / 1 min ~97 % FTP im Wechsel, 5 min locker.',
    [[120, 0.88, 'Under'], [60, 0.97, 'Over']], [[3, 9], [3, 12], [3, 15]], 'Sweetspot Over-Under', '2 min ~88 % / 1 min ~97 % FTP im Wechsel'),
  ...family('ride-sweetspot-density', 'ride', 'Sweetspot-Dichte', ['sweetspot', 'classic'], 'Immer 48 min bei ~90 % FTP: Intervalle werden länger, Pausen kürzer.',
    [[6, 8, 3], [4, 12, 2], [2, 24, 2]].map(([n, minutes, rest], i) => [PHASES[i], `${n} × ${minutes} min Sweetspot, ${rest} min Pause`,
      [warm(), reps(n, step('interval', min(minutes), 0.9, 'Sweetspot'), spin(min(rest))), cool()],
      `${libraryPhases[PHASES[i]].label} Sweetspot-Dichte: ${n} × ${minutes} min bei ~90 % FTP, ${rest} min locker. Gleicher Umfang, weniger Erholung.`])),
  ...family('ride-sweetspot-longride', 'ride', 'Lange Ausfahrt mit Sweetspot', ['sweetspot', 'long', 'base'], 'Grundlage bei ~65 % FTP, Sweetspot-Blöcke bei ~90 % FTP in der zweiten Hälfte.',
    [[120, 60, 15, '2 h'], [150, 75, 20, '2:30 h'], [180, 90, 30, '3 h']].map(([total, before, minutes, hours], i) => [PHASES[i], `${hours} Grundlage mit 2 × ${minutes} min Sweetspot`,
      [step('active', min(before), 0.65, 'Grundlage'), step('interval', min(minutes), 0.9, 'Sweetspot'), step('active', min(10), 0.65, 'Grundlage'),
        step('interval', min(minutes), 0.9, 'Sweetspot'), step('active', min(total - before - 10 - 2 * minutes), 0.65, 'Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${hours} Grundlage bei ~65 % FTP, nach ${before} min 2 × ${minutes} min Sweetspot bei ~90 % FTP mit 10 min dazwischen. Früh verpflegen.`])),
  ...family('ride-tempo', 'ride', 'Tempo', ['tempo'], 'Lange Tempoabschnitte bei ~82 % FTP.', [
    ['start', '2 × 20 min Tempo', [warm(), reps(2, step('active', min(20), 0.82, 'Tempo'), spin(min(5))), cool()],
      'Block-Start Tempo: 2 × 20 min bei ~82 % FTP.'],
    ['mid', '2 × 30 min Tempo', [warm(), reps(2, step('active', min(30), 0.82, 'Tempo'), spin(min(5))), cool()],
      'Block-Mitte Tempo: 2 × 30 min bei ~82 % FTP.'],
    ['end', '2 × 45 min Tempo', [warm(), reps(2, step('active', min(45), 0.82, 'Tempo'), spin(min(5))), cool()],
      'Block-Ende Tempo: 2 × 45 min bei ~82 % FTP. Kohlenhydrate einplanen.'],
  ]),
  ...family('ride-base', 'ride', 'Grundlage', ['base'], 'Ruhige Ausdauer bei ~65 % FTP, Dauer steigt über den Block.', [
    ['start', 'Grundlage 90 min', [step('active', min(90), 0.65, 'Grundlage')],
      'Block-Start Grundlage: 90 min gleichmäßig bei ~65 % FTP.'],
    ['mid', 'Grundlage 2 h', [step('active', min(120), 0.65, 'Grundlage')],
      'Block-Mitte Grundlage: 2 h gleichmäßig bei ~65 % FTP.'],
    ['end', 'Grundlage 3 h', [step('active', min(180), 0.65, 'Grundlage')],
      'Block-Ende Grundlage: 3 h bei ~65 % FTP. Früh und regelmäßig verpflegen.'],
  ]).map(entry => entry.phase === 'start' ? entry : { ...entry, tags: ['base', 'long'] }),
  ...family('ride-k3', 'ride', 'Kraftausdauer K3', ['strength', 'tempo'], 'Niedrige Kadenz (55–65 rpm) bei ~85 % FTP, am besten am Anstieg.', [
    ['start', '3 × 8 min K3', [warm(), reps(3, step('interval', min(8), 0.85, 'K3 · 55–65 rpm'), spin(min(4))), cool()],
      'Block-Start K3: 3 × 8 min bei ~85 % FTP mit 55–65 rpm. Oberkörper ruhig halten.'],
    ['mid', '4 × 10 min K3', [warm(), reps(4, step('interval', min(10), 0.85, 'K3 · 55–65 rpm'), spin(min(4))), cool()],
      'Block-Mitte K3: 4 × 10 min bei ~85 % FTP mit 55–65 rpm.'],
    ['end', '3 × 15 min K3', [warm(), reps(3, step('interval', min(15), 0.85, 'K3 · 55–65 rpm'), spin(min(5))), cool()],
      'Block-Ende K3: 3 × 15 min bei ~85 % FTP mit 55–65 rpm.'],
  ]),
  ...family('ride-sit', 'ride', 'Sprintintervalle (SIT)', ['anaerobic', 'sprint'], '30 s nahezu maximal, 4 min sehr locker. Anzahl steigt.', [
    ['start', '4 × 30 s SIT', [warm(20), reps(4, step('interval', 30, [1.6, 2.2], 'All-out'), spin(min(4))), cool(15)],
      'Block-Start SIT: 4 × 30 s nahezu maximal, 4 min sehr locker. Jeder Sprint mit voller Qualität.'],
    ['mid', '6 × 30 s SIT', [warm(20), reps(6, step('interval', 30, [1.6, 2.2], 'All-out'), spin(min(4))), cool(15)],
      'Block-Mitte SIT: 6 × 30 s nahezu maximal, 4 min sehr locker.'],
    ['end', '8 × 30 s SIT', [warm(20), reps(8, step('interval', 30, [1.6, 2.2], 'All-out'), spin(min(4))), cool(15)],
      'Block-Ende SIT: 8 × 30 s nahezu maximal, 4 min sehr locker.'],
  ]),
  ...family('ride-base-progressive', 'ride', 'Progressive Grundlage', ['base', 'progressive'], 'Drei gleich lange Drittel bei ~60, ~65 und ~72 % FTP: sehr ruhig beginnen, in der oberen Grundlage enden.',
    [90, 120, 150].map((total, i) => [PHASES[i], `Progressive Grundlage ${durationText(total)}`,
      [step('active', min(total) / 3, 0.6, 'Grundlage ruhig'), step('active', min(total) / 3, 0.65, 'Grundlage'), step('active', min(total) / 3, 0.72, 'Obere Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${durationText(total)} Grundlage in Dritteln bei ~60 → 65 → 72 % FTP.`])),
  ...family('ride-base-upper', 'ride', 'Obere Grundlage', ['base'], 'Gleichmäßig bei 70–75 % FTP. Kürzer, aber dichter als die normale Grundlage.',
    [75, 90, 120].map((total, i) => [PHASES[i], `Obere Grundlage ${durationText(total)}`,
      [step('active', min(total), [0.7, 0.75], 'Obere Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${durationText(total)} gleichmäßig bei 70–75 % FTP. Gut, wenn wenig Zeit ist.`])),
  ...family('ride-base-cadence', 'ride', 'Grundlage mit Kadenzspiel', ['base', 'cadence'], 'Grundlage bei ~65 % FTP mit Abschnitten hoher Kadenz (110–120 rpm) bei gleicher Leistung, 3 min normal dazwischen.',
    [[90, 6, 1], [120, 8, 2], [150, 10, 2]].map(([total, n, minutes], i) => [PHASES[i], `Grundlage ${durationText(total)} mit ${n} × ${minutes} min hoher Kadenz`,
      [step('active', min(30), 0.65, 'Grundlage'), reps(n, step('active', min(minutes), 0.65, 'Hohe Kadenz · 110–120 rpm'), step('active', min(3), 0.65, 'Grundlage')),
        step('active', min(total - 30 - n * (minutes + 3)), 0.65, 'Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${durationText(total)} bei ~65 % FTP, nach 30 min ${n} × ${minutes} min mit 110–120 rpm, 3 min normal dazwischen. Rund treten, nicht hüpfen.`])),
  ...family('ride-base-strength', 'ride', 'Grundlage mit Kraftabschnitten', ['base', 'strength'], 'Grundlage bei ~65 % FTP mit Abschnitten bei ~75 % FTP und 55–65 rpm, 5 min normal dazwischen. Am besten am Anstieg.',
    [[90, 5, 5], [120, 6, 6], [150, 6, 8]].map(([total, n, minutes], i) => [PHASES[i], `Grundlage ${durationText(total)} mit ${n} × ${minutes} min Kraft`,
      [step('active', min(20), 0.65, 'Grundlage'), reps(n, step('interval', min(minutes), 0.75, 'Kraft · 55–65 rpm'), step('active', min(5), 0.65, 'Grundlage')),
        step('active', min(total - 20 - n * (minutes + 5)), 0.65, 'Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${durationText(total)} bei ~65 % FTP mit ${n} × ${minutes} min bei ~75 % FTP und 55–65 rpm, 5 min normal dazwischen. Oberkörper ruhig halten.`])),
  ...family('ride-base-sprints', 'ride', 'Grundlage mit Sprints', ['base', 'sprint'], 'Grundlage bei ~62 % FTP mit einem 10-s-Sprint alle 5 min. Hält die Spitzenleistung in Grundlagenphasen wach.',
    [[90, 6], [120, 8], [150, 10]].map(([total, n], i) => [PHASES[i], `Grundlage ${durationText(total)} mit ${n} Sprints`,
      [step('active', min(20), 0.62, 'Grundlage'), reps(n, step('interval', 10, [1.8, 2.5], 'Sprint'), step('active', 290, 0.62, 'Grundlage')),
        step('active', min(total - 20 - n * 5), 0.65, 'Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${durationText(total)} Grundlage mit ${n} × 10 s Sprint alle 5 min. Jeder Sprint mit voller Qualität.`])),
  ...family('ride-base-tempofinish', 'ride', 'Grundlage mit Tempo-Finish', ['base', 'tempo', 'long'], 'Ruhige Grundlage bei ~65 % FTP, das letzte Stück bei ~80 % FTP, wenn die Beine schon müde sind.',
    [[120, 20], [150, 30], [180, 40]].map(([total, minutes], i) => [PHASES[i], `${durationText(total)} Grundlage mit ${minutes} min Tempo-Finish`,
      [step('active', min(total - minutes), 0.65, 'Grundlage'), step('active', min(minutes), 0.8, 'Tempo-Finish')],
      `${libraryPhases[PHASES[i]].label}: ${durationText(total)} bei ~65 % FTP, die letzten ${minutes} min Tempo bei ~80 % FTP. Früh verpflegen.`])),
  ...family('ride-base-durability', 'ride', 'Ermüdungsresistenz', ['base', 'long', 'threshold'], 'Lange Grundlage bei ~65 % FTP, ganz am Ende Intervalle bei ~95 % FTP. Trainiert späte Leistung im Rennen (Durability).',
    [[120, 8], [150, 10], [180, 12]].map(([total, minutes], i) => [PHASES[i], `${durationText(total)} Grundlage + 2 × ${minutes} min Schwelle`,
      [step('active', min(total - 2 * minutes - 15), 0.65, 'Grundlage'), step('interval', min(minutes), 0.95, 'Schwelle'), spin(min(5)), step('interval', min(minutes), 0.95, 'Schwelle'), cool()],
      `${libraryPhases[PHASES[i]].label}: ${durationText(total)} insgesamt, nach der Grundlage bei ~65 % FTP 2 × ${minutes} min bei ~95 % FTP mit 5 min locker, danach 10 min ausfahren.`])),
  single('ride-base-tempo', 'ride', 'Grundlage mit Tempoblöcken', ['base', 'tempo', 'long'],
    [step('active', min(30), 0.65, 'Grundlage'), reps(2, step('active', min(20), 0.82, 'Tempo'), step('active', min(10), 0.65, 'Grundlage')), step('active', min(30), 0.65, 'Grundlage')],
    '2 h Grundlage mit 2 × 20 min Tempo bei ~82 % FTP.'),
  single('ride-recovery-45', 'ride', 'Regeneration 45 min', ['recovery'],
    [step('active', min(45), 0.5, 'Sehr locker')],
    '45 min sehr locker unter 55 % FTP, hohe Kadenz. Nur durchbewegen, keine Belastung.'),
  single('ride-recovery-60', 'ride', 'Regeneration 60 min', ['recovery'],
    [step('active', min(60), 0.52, 'Sehr locker')],
    '60 min sehr locker unter 55 % FTP. Für den Tag nach harten Einheiten.'),
  single('ride-opener', 'ride', 'Aktivierung vor dem Rennen', ['race'],
    [warm(20), reps(3, step('interval', min(1), 1.1, 'Aktivierung'), spin(min(3))), reps(2, step('interval', 15, [1.5, 2.0], 'Antritt'), spin(165)), cool()],
    'Vortag oder Morgen vor dem Rennen: 3 × 1 min ~110 % FTP und 2 kurze Antritte. Frisch bleiben, nicht ermüden.'),
  single('ride-ftp-test', 'ride', 'FTP-Test 20 min', ['test', 'threshold'],
    [warm(15), step('active', min(5), 1.05, 'Vorbelastung'), spin(min(10)), step('interval', min(20), null, '20 min so gleichmäßig hart wie möglich'), cool(15)],
    '20-min-Test: Durchschnittsleistung × 0,95 ≈ FTP. Ausgeruht fahren und gleichmäßig einteilen.'),
];

const lengthText = duration => typeof duration === 'number' ? clockText(duration)
  : duration.m >= 2000 && duration.m % 1000 === 0 ? `${duration.m / 1000} km` : `${duration.m} m`;
const hrText = target => `${targetText(target)} HFmax`;
const RUN_VO2 = [0.9, 0.95], RUN_THRESHOLD = [0.86, 0.9], RUN_TEMPO = [0.82, 0.87], RUN_LONG = [0.68, 0.78];

// Repeats of one running interval with a jog; `variants` are [count, duration] for start, middle and end.
const runIntervals = (key, familyTitle, tags, note, rest, target, variants, name) => family(key, 'run', familyTitle, tags, note,
  variants.map(([n, work], i) => [PHASES[i], `${n} × ${lengthText(work)} ${name}`,
    [runWarm(), reps(n, step('interval', work, target, name), jog(rest)), runCool()],
    `${libraryPhases[PHASES[i]].label} ${familyTitle}: ${n} × ${lengthText(work)} bei ${hrText(target)}, ${lengthText(rest)} Trabpause.`]));
const runRepeats = (key, familyTitle, tags, note, work, rest, target, counts, name) =>
  runIntervals(key, familyTitle, tags, note, rest, target, counts.map(n => [n, work]), name);

// Short fast/jog repeats in 3 series; the heart rate climbs over each series.
const runSeries = (key, familyTitle, work, rest, counts) => family(key, 'run', familyTitle, ['vo2max', 'micro'],
  `Serien aus ${work} s schnell (etwa 3000-m-Tempo) / ${rest} s Traben, 3 min Serienpause. Die HF steigt über die Serie auf über 90 % HFmax.`,
  counts.map((count, i) => [PHASES[i], `3 × ${count} × ${work}/${rest} s`,
    [runWarm(), ...series(3, reps(count, step('interval', work, [0.9, 0.97], 'Schnell'), jog(rest, 'Traben')), jog(min(3), 'Serienpause')), runCool()],
    `${libraryPhases[PHASES[i]].label} ${work}/${rest}: 3 Serien à ${count} × ${work} s schnell / ${rest} s Traben, 3 min Serienpause.`]));

// Intervals built from a repeating pattern (or `pattern(minutes)`) with a jog; `variants` are [count, minutes].
const runPattern = (key, familyTitle, tags, note, pattern, variants, name, detail, rest = min(3)) => family(key, 'run', familyTitle, tags, note,
  variants.map(([n, minutes], i) => [PHASES[i], `${n} × ${minutes} min ${name}`,
    [runWarm(), ...series(n, cycle(min(minutes), typeof pattern === 'function' ? pattern(minutes) : pattern), jog(rest), 'Intervall'), runCool()],
    `${libraryPhases[PHASES[i]].label} ${familyTitle}: ${n} × ${minutes} min, ${detail}, ${lengthText(rest)} Trabpause.`]));

// Single running intervals of their own length and target with a jog between them.
const runLadder = (intervals, rest) => intervals.flatMap(([duration, target, name], index) =>
  [step('interval', duration, target, name), ...(index < intervals.length - 1 ? [jog(rest)] : [])]);
const RUN_LADDER = { 1: [0.92, 0.96], 2: [0.91, 0.95], 3: [0.9, 0.94], 4: [0.88, 0.92], 5: [0.88, 0.92], 6: [0.88, 0.92] };
const CUT_DOWN = { 3000: [0.85, 0.88], 2000: [0.86, 0.89], 1500: [0.87, 0.9], 1000: [0.88, 0.91] };

const runLibrary = [
  ...family('run-vo2-1000', 'run', 'VO2max 1000 m', ['vo2max'], '1000-m-Intervalle bei 90–95 % HFmax, 2:30 min Trabpause.', [
    ['start', '4 × 1000 m', [runWarm(), reps(4, step('interval', { m: 1000 }, [0.9, 0.95], '1000 m zügig'), jog(150)), runCool()],
      'Block-Start: 4 × 1000 m bei 90–95 % HFmax, 2:30 min Trabpause.'],
    ['mid', '5 × 1000 m', [runWarm(), reps(5, step('interval', { m: 1000 }, [0.9, 0.95], '1000 m zügig'), jog(150)), runCool()],
      'Block-Mitte: 5 × 1000 m bei 90–95 % HFmax, 2:30 min Trabpause.'],
    ['end', '6 × 1000 m', [runWarm(), reps(6, step('interval', { m: 1000 }, [0.9, 0.95], '1000 m zügig'), jog(150)), runCool()],
      'Block-Ende: 6 × 1000 m bei 90–95 % HFmax, 2:30 min Trabpause.'],
  ]),
  ...family('run-vo2-3', 'run', 'VO2max 3 min', ['vo2max'], '3-min-Intervalle bei 90–95 % HFmax, 2 min Trabpause.', [
    ['start', '4 × 3 min VO2max', [runWarm(), reps(4, step('interval', min(3), [0.9, 0.95], 'VO2max'), jog(min(2))), runCool()],
      'Block-Start: 4 × 3 min bei 90–95 % HFmax, 2 min Trabpause.'],
    ['mid', '5 × 3 min VO2max', [runWarm(), reps(5, step('interval', min(3), [0.9, 0.95], 'VO2max'), jog(min(2))), runCool()],
      'Block-Mitte: 5 × 3 min bei 90–95 % HFmax, 2 min Trabpause.'],
    ['end', '6 × 3 min VO2max', [runWarm(), reps(6, step('interval', min(3), [0.9, 0.95], 'VO2max'), jog(min(2))), runCool()],
      'Block-Ende: 6 × 3 min bei 90–95 % HFmax, 2 min Trabpause.'],
  ]),
  ...family('run-threshold', 'run', 'Schwellenlauf', ['threshold'], 'Intervalle an der Schwelle (86–90 % HFmax), kurze Trabpausen.', [
    ['start', '3 × 8 min Schwelle', [runWarm(), reps(3, step('interval', min(8), [0.86, 0.9], 'Schwelle'), jog(min(2))), runCool()],
      'Block-Start Schwelle: 3 × 8 min bei 86–90 % HFmax, 2 min Trabpause.'],
    ['mid', '3 × 10 min Schwelle', [runWarm(), reps(3, step('interval', min(10), [0.86, 0.9], 'Schwelle'), jog(min(2))), runCool()],
      'Block-Mitte Schwelle: 3 × 10 min bei 86–90 % HFmax, 2 min Trabpause.'],
    ['end', '3 × 12 min Schwelle', [runWarm(), reps(3, step('interval', min(12), [0.86, 0.9], 'Schwelle'), jog(min(2))), runCool()],
      'Block-Ende Schwelle: 3 × 12 min bei 86–90 % HFmax, 2 min Trabpause.'],
  ]),
  ...family('run-tempo', 'run', 'Tempodauerlauf', ['tempo', 'threshold'], 'Durchgehender Tempoabschnitt bei 82–87 % HFmax.', [
    ['start', 'Tempodauerlauf 20 min', [runWarm(), step('active', min(20), [0.82, 0.87], 'Tempo'), runCool()],
      'Block-Start: 20 min Tempodauerlauf bei 82–87 % HFmax.'],
    ['mid', 'Tempodauerlauf 30 min', [runWarm(), step('active', min(30), [0.82, 0.87], 'Tempo'), runCool()],
      'Block-Mitte: 30 min Tempodauerlauf bei 82–87 % HFmax.'],
    ['end', 'Tempodauerlauf 40 min', [runWarm(), step('active', min(40), [0.82, 0.87], 'Tempo'), runCool()],
      'Block-Ende: 40 min Tempodauerlauf bei 82–87 % HFmax.'],
  ]),
  ...family('run-long', 'run', 'Langer Lauf', ['base', 'long'], 'Ruhiger langer Lauf bei 68–78 % HFmax, Dauer steigt.', [
    ['start', 'Langer Lauf 75 min', [step('active', min(75), [0.68, 0.78], 'Grundlage')],
      'Block-Start: 75 min ruhig bei 68–78 % HFmax.'],
    ['mid', 'Langer Lauf 90 min', [step('active', min(90), [0.68, 0.78], 'Grundlage')],
      'Block-Mitte: 90 min ruhig bei 68–78 % HFmax.'],
    ['end', 'Langer Lauf 110 min', [step('active', min(110), [0.68, 0.78], 'Grundlage')],
      'Block-Ende: 110 min ruhig bei 68–78 % HFmax. Getränk und Gel mitnehmen.'],
  ]),
  ...family('run-hills', 'run', 'Bergintervalle', ['strength', 'vo2max'], '60 s zügig bergauf, locker zurück traben.', [
    ['start', '6 × 60 s bergauf', [runWarm(), reps(6, step('interval', min(1), [0.88, 0.95], 'Bergauf'), jog(min(2), 'Bergab traben')), runCool()],
      'Block-Start Berg: 6 × 60 s zügig bergauf (5–8 % Steigung), locker zurück traben.'],
    ['mid', '8 × 60 s bergauf', [runWarm(), reps(8, step('interval', min(1), [0.88, 0.95], 'Bergauf'), jog(min(2), 'Bergab traben')), runCool()],
      'Block-Mitte Berg: 8 × 60 s zügig bergauf, locker zurück traben.'],
    ['end', '10 × 60 s bergauf', [runWarm(), reps(10, step('interval', min(1), [0.88, 0.95], 'Bergauf'), jog(min(2), 'Bergab traben')), runCool()],
      'Block-Ende Berg: 10 × 60 s zügig bergauf, locker zurück traben.'],
  ]),
  ...family('run-easy-progressive', 'run', 'Lockerer Lauf progressiv', ['base', 'progressive'], 'Drei gleich lange Drittel bei 68–72, 72–76 und 76–80 % HFmax.',
    [40, 50, 60].map((total, i) => [PHASES[i], `Lockerer Lauf progressiv ${total} min`,
      [step('active', min(total) / 3, [0.68, 0.72], 'Locker'), step('active', min(total) / 3, [0.72, 0.76], 'Etwas zügiger'), step('active', min(total) / 3, [0.76, 0.8], 'Obere Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${total} min locker in Dritteln bei 68–72 → 72–76 → 76–80 % HFmax.`])),
  ...family('run-easy-strides', 'run', 'Lockerer Lauf mit Steigerungen', ['base', 'sprint'], 'Lockerer Lauf bei 65–75 % HFmax, am Ende 20-s-Steigerungen bis ~95 % Tempo mit 60 s Trabpause.',
    [[40, 4], [45, 6], [50, 8]].map(([total, n], i) => [PHASES[i], `Lockerer Lauf ${total} min + ${n} Steigerungen`,
      [step('active', min(total), [0.65, 0.75], 'Locker'), reps(n, step('interval', 20, null, 'Steigerung'), step('recovery', 60, null, 'Locker traben')), step('cooldown', min(5), [0.6, 0.72], 'Auslaufen')],
      `${libraryPhases[PHASES[i]].label}: ${total} min locker, dann ${n} × 20 s Steigerungsläufe bis ~95 % Tempo, 60 s Trabpause. Locker und technisch sauber.`])),
  ...runRepeats('run-vo2-400', 'VO2max 400 m', ['vo2max', 'classic'], '400-m-Intervalle bei 90–95 % HFmax, 90 s Trabpause. Die Anzahl steigt über den Block.', { m: 400 }, 90, RUN_VO2, [8, 10, 12], 'VO2max'),
  ...runRepeats('run-vo2-800', 'VO2max 800 m', ['vo2max', 'classic'], '800-m-Intervalle bei 90–95 % HFmax, 2 min Trabpause.', { m: 800 }, min(2), RUN_VO2, [5, 6, 8], 'VO2max'),
  ...runRepeats('run-vo2-1200', 'VO2max 1200 m', ['vo2max', 'classic'], '1200-m-Intervalle bei 90–94 % HFmax, 3 min Trabpause.', { m: 1200 }, min(3), [0.9, 0.94], [3, 4, 5], 'VO2max'),
  ...runRepeats('run-vo2-1600', 'VO2max 1600 m', ['vo2max', 'classic'], 'Lange VO2max-Intervalle über 1600 m bei 89–94 % HFmax, 3 min Trabpause. Gleichmäßig einteilen.', { m: 1600 }, min(3), [0.89, 0.94], [3, 4, 5], 'VO2max'),
  ...runRepeats('run-vo2-2', 'VO2max 2 min', ['vo2max', 'classic'], '2-min-Intervalle bei 90–95 % HFmax, 90 s Trabpause.', min(2), 90, RUN_VO2, [6, 8, 10], 'VO2max'),
  ...runRepeats('run-vo2-4', 'VO2max 4 min', ['vo2max', 'classic'], 'Norwegisches 4 × 4: 4-min-Intervalle bei 90–95 % HFmax, 3 min Trabpause.', min(4), min(3), RUN_VO2, [3, 4, 5], 'VO2max'),
  ...runRepeats('run-vo2-5', 'VO2max 5 min', ['vo2max', 'classic'], 'Lange 5-min-Intervalle bei 89–94 % HFmax, 3 min Trabpause.', min(5), min(3), [0.89, 0.94], [3, 4, 5], 'VO2max'),
  ...runRepeats('run-vo2-11', 'VO2max 1/1', ['vo2max', 'classic'], '1 min schnell bei 90–95 % HFmax, 1 min Trabpause. Die HF bleibt über die Einheit hoch.', min(1), min(1), RUN_VO2, [10, 12, 15], 'VO2max'),
  ...runSeries('run-vo2-3030', 'VO2max 30/30', 30, 30, [6, 8, 10]),
  ...runSeries('run-vo2-3015', 'VO2max 30/15', 30, 15, [8, 10, 12]),
  ...family('run-vo2-pyramid', 'run', 'VO2max-Pyramide', ['vo2max', 'variable'], 'Stufen von 1 bis 5 min, kurze Stufen bei 90–95 %, lange bei 88–93 % HFmax. Trabpause so lang wie die Stufe davor.',
    [[1, 2, 3, 2, 1], [1, 2, 3, 4, 3, 2, 1], [2, 3, 4, 5, 4, 3, 2]].map((stairs, i) => [PHASES[i], `Lauf-Pyramide ${stairs.join('-')} min`,
      [runWarm(), ...stairs.flatMap((minutes, index) => [step('interval', min(minutes), minutes <= 2 ? RUN_VO2 : [0.88, 0.93], `${minutes} min`), ...(index < stairs.length - 1 ? [jog(min(minutes))] : [])]), runCool()],
      `${libraryPhases[PHASES[i]].label} Pyramide ${stairs.join('-')} min: kurze Stufen bei 90–95 %, lange bei 88–93 % HFmax. Trabpause so lang wie die Stufe davor.`])),
  ...family('run-vo2-distpyramid', 'run', 'Distanz-Pyramide', ['vo2max', 'variable'], 'Pyramide über 400 bis 1600 m bei 88–95 % HFmax, je 200 m Trabpause.',
    [[400, 800, 1200, 800, 400], [400, 800, 1200, 1200, 800, 400], [400, 800, 1200, 1600, 1200, 800, 400]].map((stairs, i) => [PHASES[i], `Pyramide ${stairs.join('-')} m`,
      [runWarm(), ...runLadder(stairs.map(metres => [{ m: metres }, [0.88, 0.95], `${metres} m`]), { m: 200 }), runCool()],
      `${libraryPhases[PHASES[i]].label} Pyramide ${stairs.join('-')} m bei 88–95 % HFmax, je 200 m Trabpause.`])),
  ...family('run-vo2-ladder', 'run', 'Absteigende Leiter', ['vo2max', 'progressive'], 'Die Stufen werden kürzer und schneller: lange bei 88–92 %, 1 min bei 92–96 % HFmax. 2 min Trabpause.',
    [[4, 3, 2, 1], [5, 4, 3, 2, 1], [6, 5, 4, 3, 2, 1]].map((stairs, i) => [PHASES[i], `Leiter ${stairs.join('-')} min`,
      [runWarm(), ...runLadder(stairs.map(minutes => [min(minutes), RUN_LADDER[minutes], `${minutes} min`]), min(2)), runCool()],
      `${libraryPhases[PHASES[i]].label} Leiter ${stairs.join('-')} min, jede Stufe etwas schneller (88 → 96 % HFmax), 2 min Trabpause.`])),
  ...family('run-vo2-float', 'run', 'Float-Intervalle', ['vo2max', 'variable'], '1000 m bei 90–95 % HFmax, dazwischen 400 m zügig weiterlaufen statt traben (Float, 75–82 % HFmax).',
    [4, 5, 6].map((n, i) => [PHASES[i], `${n} × 1000 m mit Float`,
      [runWarm(), reps(n, step('interval', { m: 1000 }, RUN_VO2, '1000 m schnell'), step('recovery', { m: 400 }, [0.75, 0.82], 'Float')), runCool()],
      `${libraryPhases[PHASES[i]].label} Float: ${n} × 1000 m bei 90–95 % HFmax, 400 m Float bei 75–82 % HFmax. Die Pause bleibt ein Lauf.`])),
  ...family('run-vo2-fartlek', 'run', 'Fahrtspiel 2/1', ['vo2max', 'variable'], '2 min schnell bei 88–93 % HFmax, 1 min locker weiterlaufen. Gut im Gelände.',
    [6, 8, 10].map((n, i) => [PHASES[i], `Fahrtspiel ${n} × 2/1 min`,
      [runWarm(), reps(n, step('interval', min(2), [0.88, 0.93], 'Schnell'), step('recovery', min(1), [0.7, 0.8], 'Locker')), runCool()],
      `${libraryPhases[PHASES[i]].label} Fahrtspiel: ${n} × 2 min bei 88–93 % HFmax / 1 min locker weiterlaufen.`])),
  ...runRepeats('run-hills-long', 'Lange Bergintervalle', ['vo2max', 'strength'], '3 min zügig bergauf bei 88–94 % HFmax, locker zurück traben. Kraftvoll und aufrecht laufen.', min(3), min(3), [0.88, 0.94], [4, 5, 6], 'bergauf'),
  ...runRepeats('run-threshold-1000', 'Schwelle 1000 m', ['threshold', 'classic'], '1000-m-Intervalle an der Schwelle (86–90 % HFmax), 60 s Trabpause. Kontrolliert, nicht auf Anschlag.', { m: 1000 }, min(1), RUN_THRESHOLD, [5, 6, 8], 'Schwelle'),
  ...runRepeats('run-threshold-2000', 'Schwelle 2 km', ['threshold', 'classic'], '2-km-Intervalle bei 86–90 % HFmax, 90 s Trabpause.', { m: 2000 }, 90, RUN_THRESHOLD, [3, 4, 5], 'Schwelle'),
  ...runRepeats('run-threshold-3000', 'Schwelle 3 km', ['threshold', 'classic'], '3-km-Intervalle bei 86–89 % HFmax, 2 min Trabpause. Gleichmäßig einteilen.', { m: 3000 }, min(2), [0.86, 0.89], [2, 3, 4], 'Schwelle'),
  ...runRepeats('run-threshold-5', 'Schwelle 5 min', ['threshold', 'classic'], '5-min-Intervalle bei 86–90 % HFmax, 1 min Trabpause.', min(5), min(1), RUN_THRESHOLD, [5, 6, 8], 'Schwelle'),
  ...runRepeats('run-threshold-6', 'Norwegische 6 min', ['threshold', 'classic'], '6-min-Intervalle an der unteren Schwelle (85–89 % HFmax), 1 min Trabpause. Kontrolliert, Laktat niedrig halten.', min(6), min(1), [0.85, 0.89], [4, 5, 6], 'Schwelle'),
  ...runRepeats('run-threshold-3', 'Norwegische 3 min', ['threshold', 'classic'], 'Viele kurze Schwellenintervalle bei 85–89 % HFmax, 1 min Trabpause. Nicht schneller werden.', min(3), min(1), [0.85, 0.89], [8, 10, 12], 'Schwelle'),
  ...runRepeats('run-threshold-400', 'Norwegische 400er', ['threshold', 'classic'], '400 m kontrolliert an der Schwelle (85–89 % HFmax), nur 30 s Pause. Viele Wiederholungen, keine Sprints.', { m: 400 }, 30, [0.85, 0.89], [15, 20, 25], 'Schwelle'),
  ...runIntervals('run-threshold-long', 'Schwelle lang', ['threshold', 'classic'], 'Lange Schwellenintervalle bei 85–89 % HFmax, 3 min Trabpause. Defensiv starten.', min(3), [0.85, 0.89],
    [[2, min(15)], [3, min(15)], [2, min(25)]], 'Schwelle'),
  ...family('run-threshold-continuous', 'run', 'Schwellendauerlauf', ['threshold', 'classic'], 'Durchgehend an der Schwelle (85–89 % HFmax). Die Dauer steigt über den Block.',
    [20, 25, 30].map((minutes, i) => [PHASES[i], `Schwellendauerlauf ${minutes} min`, [runWarm(), step('interval', min(minutes), [0.85, 0.89], 'Schwellendauerlauf'), runCool()],
      `${libraryPhases[PHASES[i]].label}: ${minutes} min durchgehend bei 85–89 % HFmax. Gleichmäßig laufen, zum Schluss nicht beschleunigen.`])),
  ...runPattern('run-overunder', 'Over-Under Lauf', ['threshold', 'overunder', 'variable'], 'Im Wechsel 3 min knapp unter (84–87 %) und 1 min über der Schwelle (90–93 % HFmax), 3 min Trabpause.',
    [[180, [0.84, 0.87], 'Under'], [60, [0.9, 0.93], 'Over']], [[3, 8], [3, 12], [3, 16]], 'Over-Under', '3 min 84–87 % / 1 min 90–93 % HFmax im Wechsel'),
  ...runPattern('run-threshold-progressive', 'Progressive Schwelle', ['threshold', 'progressive'], 'Jedes Intervall in drei Dritteln bei 84–86, 86–88 und 88–90 % HFmax, 2 min Trabpause.',
    minutes => [[minutes * 20, [0.84, 0.86], 'Drittel 1'], [minutes * 20, [0.86, 0.88], 'Drittel 2'], [minutes * 20, [0.88, 0.9], 'Drittel 3']],
    [[3, 9], [3, 12], [3, 15]], 'progressiv', 'je Drittel 84–86 → 86–88 → 88–90 % HFmax', min(2)),
  ...runPattern('run-threshold-surges', 'Schwelle mit Zwischenspurts', ['threshold', 'race', 'variable'], 'Schwelle bei 86–89 % HFmax, alle 3 min 20 s Zwischenspurt, danach sofort zurück ins Schwellentempo. 3 min Trabpause.',
    [[160, [0.86, 0.89], 'Schwelle'], [20, null, 'Zwischenspurt']], [[3, 9], [3, 12], [3, 15]], 'mit Zwischenspurts', 'bei 86–89 % HFmax, alle 3 min 20 s Zwischenspurt'),
  ...runPattern('run-threshold-finish', 'Schwelle mit Finish', ['threshold', 'race'], 'Schwelle bei 86–89 % HFmax, die letzte Minute jedes Intervalls schneller (90–94 %). 2 min Trabpause.',
    minutes => [[min(minutes - 1), [0.86, 0.89], 'Schwelle'], [60, [0.9, 0.94], 'Finish']], [[3, 8], [3, 10], [3, 12]], 'mit Finish', '86–89 % HFmax, letzte Minute 90–94 %', min(2)),
  ...family('run-threshold-alternating', 'run', 'Wechseltempo 400/400', ['threshold', 'variable'], 'Ohne Pause: 400 m an der Schwelle (88–91 %), 400 m etwas ruhiger (83–86 % HFmax).',
    [5, 7, 9].map((n, i) => [PHASES[i], `Wechseltempo ${n} × (400 + 400 m)`,
      [runWarm(), reps(n, step('interval', { m: 400 }, [0.88, 0.91], '400 m Schwelle'), step('interval', { m: 400 }, [0.83, 0.86], '400 m ruhiger')), runCool()],
      `${libraryPhases[PHASES[i]].label}: ${n * 800} m am Stück, im Wechsel 400 m bei 88–91 % und 400 m bei 83–86 % HFmax.`])),
  ...family('run-threshold-pyramid', 'run', 'Schwellen-Pyramide', ['threshold', 'variable'], 'Schwellenintervalle als Pyramide bei 86–89 % HFmax, 2 min Trabpause.',
    [[8, 12, 8], [10, 15, 10], [8, 12, 16, 12]].map((stairs, i) => [PHASES[i], `Schwellen-Pyramide ${stairs.join('-')} min`,
      [runWarm(), ...runLadder(stairs.map(minutes => [min(minutes), [0.86, 0.89], `${minutes} min`]), min(2)), runCool()],
      `${libraryPhases[PHASES[i]].label} Pyramide ${stairs.join('-')} min bei 86–89 % HFmax, 2 min Trabpause.`])),
  ...family('run-threshold-broken', 'run', 'Broken Threshold', ['threshold', 'variable'], 'Blöcke aus drei Schwellenabschnitten (86–90 % HFmax) mit je 30 s Traben, 3 min zwischen den Blöcken.',
    [[2, 4], [2, 5], [3, 4]].map(([n, minutes], i) => [PHASES[i], `${n} × (${minutes} + ${minutes} + ${minutes} min) Broken`,
      [runWarm(), ...series(n, [reps(2, step('interval', min(minutes), RUN_THRESHOLD, 'Schwelle'), jog(30, 'Kurz traben')), step('interval', min(minutes), RUN_THRESHOLD, 'Schwelle')], jog(min(3)), 'Block'), runCool()],
      `${libraryPhases[PHASES[i]].label} Broken Threshold: ${n} Blöcke aus 3 × ${minutes} min bei 86–90 % HFmax mit 30 s Traben, 3 min zwischen den Blöcken.`])),
  ...family('run-threshold-cutdown', 'run', 'Cut-Down', ['threshold', 'progressive'], 'Die Abschnitte werden kürzer und schneller: von 85–88 % bis 88–91 % HFmax, 90 s Trabpause.',
    [[2000, 1500, 1000], [3000, 2000, 1000], [3000, 2000, 2000, 1000]].map((stairs, i) => [PHASES[i], `Cut-Down ${stairs.join('-')} m`,
      [runWarm(), ...runLadder(stairs.map(metres => [{ m: metres }, CUT_DOWN[metres], `${metres} m`]), 90), runCool()],
      `${libraryPhases[PHASES[i]].label} Cut-Down ${stairs.join('-')} m, jede Strecke etwas schneller (85 → 91 % HFmax), 90 s Trabpause.`])),
  ...family('run-threshold-vo2', 'run', 'Schwelle + VO2max-Finish', ['threshold', 'vo2max'], 'Schwellenintervalle bei 86–90 % HFmax, danach 1-min-Intervalle bei 90–95 % mit 1 min Trabpause.',
    [[2, 8, 3], [3, 8, 4], [3, 10, 5]].map(([n, minutes, fast], i) => [PHASES[i], `${n} × ${minutes} min Schwelle + ${fast} × 1 min`,
      [runWarm(), reps(n, step('interval', min(minutes), RUN_THRESHOLD, 'Schwelle'), jog(min(2))), reps(fast, step('interval', min(1), RUN_VO2, 'VO2max'), jog(min(1))), runCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × ${minutes} min bei 86–90 % HFmax (2 min Trabpause), danach ${fast} × 1 min bei 90–95 % mit 1 min Trabpause.`])),
  ...family('run-threshold-durability', 'run', 'Langer Lauf mit Schwellen-Finish', ['base', 'long', 'threshold'], 'Ruhiger langer Lauf, am Ende zwei Schwellenintervalle bei 86–89 % HFmax mit müden Beinen.',
    [[70, 8], [85, 10], [100, 12]].map(([total, minutes], i) => [PHASES[i], `${total} min mit 2 × ${minutes} min Schwelle`,
      [step('active', min(total - 2 * minutes - 7), RUN_LONG, 'Grundlage'), step('interval', min(minutes), [0.86, 0.89], 'Schwelle'), jog(min(2)), step('interval', min(minutes), [0.86, 0.89], 'Schwelle'), runCool(5)],
      `${libraryPhases[PHASES[i]].label}: ${total} min, nach der Grundlage (68–78 % HFmax) 2 × ${minutes} min bei 86–89 % mit 2 min Trabpause, 5 min auslaufen.`])),
  ...runIntervals('run-tempo-intervals', 'Tempointervalle', ['tempo', 'classic'], 'Tempo bei 82–87 % HFmax, 2 min Trabpause. Angenehm hart und gut kontrollierbar.', min(2), RUN_TEMPO,
    [[3, min(10)], [3, min(12)], [3, min(15)]], 'Tempo'),
  ...family('run-tempo-progressive', 'run', 'Progressiver Dauerlauf', ['tempo', 'progressive'], 'Drei gleich lange Drittel: locker (70–76 %), zügig (78–82 %) und Tempo (83–87 % HFmax).',
    [45, 60, 75].map((total, i) => [PHASES[i], `Progressiver Dauerlauf ${total} min`,
      [step('active', min(total) / 3, [0.7, 0.76], 'Locker'), step('active', min(total) / 3, [0.78, 0.82], 'Zügig'), step('active', min(total) / 3, [0.83, 0.87], 'Tempo')],
      `${libraryPhases[PHASES[i]].label}: ${total} min in Dritteln bei 70–76 → 78–82 → 83–87 % HFmax.`])),
  ...family('run-tempo-long', 'run', 'Langer Lauf mit Tempoblöcken', ['base', 'tempo', 'long'], 'Langer Lauf bei 68–78 % HFmax mit zwei Tempoblöcken (82–87 %) in der zweiten Hälfte.',
    [[75, 10], [90, 15], [105, 20]].map(([total, minutes], i) => [PHASES[i], `${total} min mit 2 × ${minutes} min Tempo`,
      [step('active', min(total - 2 * minutes - 15), RUN_LONG, 'Grundlage'), step('interval', min(minutes), RUN_TEMPO, 'Tempo'), step('active', min(5), RUN_LONG, 'Grundlage'),
        step('interval', min(minutes), RUN_TEMPO, 'Tempo'), step('active', min(10), RUN_LONG, 'Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${total} min bei 68–78 % HFmax mit 2 × ${minutes} min Tempo (82–87 %), 5 min locker dazwischen. Getränk mitnehmen.`])),
  ...family('run-tempo-marathon', 'run', 'Marathon-Renntempo', ['tempo', 'race', 'long'], 'Abschnitte im geplanten Marathontempo (80–85 % HFmax), 3 min locker dazwischen. Verpflegung testen.',
    [[2, 15], [2, 20], [3, 20]].map(([n, minutes], i) => [PHASES[i], `${n} × ${minutes} min Marathontempo`,
      [runWarm(), reps(n, step('interval', min(minutes), [0.8, 0.85], 'Marathontempo'), step('recovery', min(3), [0.68, 0.75], 'Locker')), runCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × ${minutes} min im Marathontempo (80–85 % HFmax), 3 min locker weiterlaufen. Gel und Getränk wie im Rennen testen.`])),
  ...runIntervals('run-tempo-halfmarathon', 'Halbmarathon-Renntempo', ['tempo', 'race'], 'Lange Abschnitte im Halbmarathontempo (84–88 % HFmax), 90 s Trabpause.', 90, [0.84, 0.88],
    [[3, { m: 2000 }], [3, { m: 3000 }], [2, { m: 5000 }]], 'HM-Tempo'),
  ...family('run-tempo-fartlek', 'run', 'Tempo-Fahrtspiel', ['tempo', 'variable'], '3 min Tempo bei 82–87 % HFmax, 2 min locker weiterlaufen.',
    [6, 8, 10].map((n, i) => [PHASES[i], `Tempo-Fahrtspiel ${n} × 3/2 min`,
      [runWarm(), reps(n, step('interval', min(3), RUN_TEMPO, 'Tempo'), step('recovery', min(2), [0.68, 0.75], 'Locker')), runCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 3 min Tempo (82–87 % HFmax) / 2 min locker weiterlaufen.`])),
  ...family('run-tempo-km', 'run', 'Kilometerwechsel', ['tempo', 'variable'], 'Ohne Pause im Wechsel: 1 km Tempo (82–87 %) und 1 km locker (72–78 % HFmax).',
    [3, 4, 5].map((n, i) => [PHASES[i], `Kilometerwechsel ${n} × (1 + 1 km)`,
      [runWarm(), reps(n, step('active', { m: 1000 }, RUN_TEMPO, '1 km Tempo'), step('active', { m: 1000 }, [0.72, 0.78], '1 km locker')), runCool()],
      `${libraryPhases[PHASES[i]].label}: ${n * 2} km am Stück, im Wechsel 1 km bei 82–87 % und 1 km bei 72–78 % HFmax.`])),
  ...family('run-tempo-finish', 'run', 'Lockerer Lauf mit Tempo-Finish', ['base', 'tempo'], 'Locker bei 65–75 % HFmax, das letzte Stück als Tempo (82–87 %).',
    [[40, 10], [50, 15], [60, 20]].map(([total, minutes], i) => [PHASES[i], `${total} min mit ${minutes} min Tempo-Finish`,
      [easy(min(total - minutes)), step('active', min(minutes), RUN_TEMPO, 'Tempo-Finish')],
      `${libraryPhases[PHASES[i]].label}: ${total} min, davon die letzten ${minutes} min Tempo bei 82–87 % HFmax.`])),
  ...family('run-base-easy', 'run', 'Lockerer Dauerlauf', ['base'], 'Ruhiger Dauerlauf bei 65–75 % HFmax, die Dauer steigt über den Block.',
    [40, 50, 60].map((total, i) => [PHASES[i], `Lockerer Dauerlauf ${total} min`, [easy(min(total))],
      `${libraryPhases[PHASES[i]].label}: ${total} min locker bei 65–75 % HFmax. Unterhalten sollte möglich sein.`])),
  ...family('run-base-upper', 'run', 'Obere Grundlage', ['base'], 'Gleichmäßig bei 75–80 % HFmax: etwas zügiger als locker, aber noch deutlich unter Tempo.',
    [40, 50, 60].map((total, i) => [PHASES[i], `Obere Grundlage ${total} min`, [step('active', min(total), [0.75, 0.8], 'Obere Grundlage')],
      `${libraryPhases[PHASES[i]].label}: ${total} min gleichmäßig bei 75–80 % HFmax.`])),
  ...family('run-long-finish', 'run', 'Langer Lauf mit Endbeschleunigung', ['base', 'long', 'progressive'], 'Ruhiger langer Lauf bei 68–78 % HFmax, das letzte Stück zügig (80–85 %).',
    [[75, 10], [90, 15], [105, 20]].map(([total, minutes], i) => [PHASES[i], `Langer Lauf ${total} min mit ${minutes} min Endbeschleunigung`,
      [step('active', min(total - minutes), RUN_LONG, 'Grundlage'), step('active', min(minutes), [0.8, 0.85], 'Endbeschleunigung')],
      `${libraryPhases[PHASES[i]].label}: ${total} min, die letzten ${minutes} min zügig bei 80–85 % HFmax. Getränk und Gel mitnehmen.`])),
  ...family('run-base-hilly', 'run', 'Hügeliger Dauerlauf', ['base', 'strength'], 'Lockerer Lauf auf welliger Strecke, bergauf kürzere Schritte und die HF unter 80 % halten.',
    [45, 60, 75].map((total, i) => [PHASES[i], `Hügeliger Dauerlauf ${total} min`, [step('active', min(total), [0.68, 0.8], 'Wellig locker')],
      `${libraryPhases[PHASES[i]].label}: ${total} min auf welliger Strecke bei 68–80 % HFmax. Bergauf Tempo rausnehmen, bergab locker rollen lassen.`])),
  ...family('run-base-hillsprints', 'run', 'Lockerer Lauf mit Bergsprints', ['base', 'sprint', 'strength'], 'Lockerer Lauf, danach 10 s maximal steil bergauf, 2 min gehen oder traben. Kraft und Laufökonomie.',
    [[40, 4], [45, 6], [50, 8]].map(([total, n], i) => [PHASES[i], `Lockerer Lauf ${total} min + ${n} Bergsprints`,
      [easy(min(total)), reps(n, step('interval', 10, null, 'Bergsprint'), step('recovery', min(2), null, 'Gehen / Traben')), runCool(5)],
      `${libraryPhases[PHASES[i]].label}: ${total} min locker, dann ${n} × 10 s Bergsprint (6–10 % Steigung) mit 2 min Pause. Jeder Sprint mit voller Qualität.`])),
  ...family('run-base-drills', 'run', 'Lauf-ABC + lockerer Lauf', ['base', 'technique'], 'Einlaufen, Lauf-ABC (Skippings, Anfersen, Hopserlauf, Seitgalopp), danach locker bei 65–75 % HFmax.',
    [[8, 30], [10, 35], [12, 40]].map(([drills, total], i) => [PHASES[i], `Lauf-ABC ${drills} min + ${total} min locker`,
      [runWarm(10), step('active', min(drills), null, 'Lauf-ABC'), easy(min(total))],
      `${libraryPhases[PHASES[i]].label}: 10 min einlaufen, ${drills} min Lauf-ABC über 30–40 m mit Gehpause zurück, dann ${total} min locker.`])),
  ...family('run-base-runwalk', 'run', 'Lauf-Geh-Wechsel', ['base'], 'Für den Einstieg oder nach einer Pause: 4 min locker laufen, 1 min gehen.',
    [6, 8, 10].map((n, i) => [PHASES[i], `${n} × (4 min laufen + 1 min gehen)`,
      [reps(n, easy(min(4), 'Laufen'), step('recovery', min(1), null, 'Gehen'))],
      `${libraryPhases[PHASES[i]].label}: ${n} × 4 min locker laufen (65–75 % HFmax) und 1 min gehen.`])),
  single('run-easy-45', 'run', 'Lockerer Lauf 45 min', ['base'],
    [step('active', min(45), [0.65, 0.75], 'Locker')],
    '45 min locker bei 65–75 % HFmax.'),
  single('run-recovery', 'run', 'Regenerationslauf 30 min', ['recovery'],
    [step('active', min(30), [0.6, 0.7], 'Sehr locker')],
    '30 min sehr locker unter 70 % HFmax. Gehpausen sind erlaubt.'),
  single('run-fartlek', 'run', 'Fahrtspiel 10 × 1 min', ['tempo', 'vo2max'],
    [runWarm(), reps(10, step('interval', min(1), [0.85, 0.92], 'Zügig'), step('recovery', min(1), [0.65, 0.75], 'Locker')), runCool()],
    'Fahrtspiel: 10 × 1 min zügig / 1 min locker weiterlaufen.'),
  single('run-opener', 'run', 'Aktivierung vor dem Wettkampf', ['race'],
    [runWarm(15), reps(4, step('interval', min(1), [0.85, 0.9], 'Renntempo'), jog(min(1))), runCool(7)],
    'Vortag des Wettkampfs: 4 × 1 min im geplanten Renntempo. Kurz und frisch.'),
];

// Swimming targets are seconds per 100 m relative to the athlete's CSS (critical swim speed): 5 = 5 s slower, -3 = 3 s faster.
// The watch gets no pace target; the offset is written into the step name.
const cssText = offset => offset === 0 ? 'CSS' : `CSS ${offset > 0 ? '+' : '−'}${Math.abs(offset)} s`;
const paceText = offset => offset === 0 ? 'CSS-Tempo' : `${cssText(offset)}/100 m`;
const swim = (metres, target, name = `${metres} m`, intensity = 'interval') => step(intensity, { m: metres }, target, target == null ? name : `${name} · ${cssText(target)}`);
const swimWarm = (metres = 400) => step('warmup', { m: metres }, 12, 'Einschwimmen locker');
const swimCool = (metres = 200) => step('cooldown', { m: metres }, 14, 'Ausschwimmen locker');
const pause = (seconds, name = 'Pause') => step('recovery', seconds, null, name);
const drill = (metres, name) => step('active', { m: metres }, null, name);

// Repeats of one distance at a CSS offset with a standing rest; `variants` are [count, metres].
const swimIntervals = (key, familyTitle, tags, note, rest, target, variants, name) => family(key, 'swim', familyTitle, tags, note,
  variants.map(([n, metres], i) => [PHASES[i], `${n} × ${metres} m ${name}`,
    [swimWarm(), reps(n, swim(metres, target), pause(rest)), swimCool()],
    `${libraryPhases[PHASES[i]].label} ${familyTitle}: ${n} × ${metres} m bei ${paceText(target)}, ${clockText(rest)} Pause.`]));
const swimRepeats = (key, familyTitle, tags, note, metres, rest, target, counts, name) =>
  swimIntervals(key, familyTitle, tags, note, rest, target, counts.map(n => [n, metres]), name);

// Short repeats in 3 series with a longer series rest; `counts` are the repeats per series.
const swimSeries = (key, familyTitle, metres, rest, target, seriesRest, counts) => family(key, 'swim', familyTitle, ['vo2max', 'micro'],
  `Serien aus ${metres} m bei ${paceText(target)} mit ${rest} s Pause, ${clockText(seriesRest)} Serienpause.`,
  counts.map((count, i) => [PHASES[i], `3 × ${count} × ${metres} m`,
    [swimWarm(), ...series(3, reps(count, swim(metres, target), pause(rest)), pause(seriesRest, 'Serienpause')), swimCool()],
    `${libraryPhases[PHASES[i]].label} ${familyTitle}: 3 Serien à ${count} × ${metres} m bei ${paceText(target)}, ${rest} s Pause, ${clockText(seriesRest)} Serienpause.`]));

// Distances of their own length, each at the offset for that distance, with a standing rest between them.
const swimLadder = (distances, offsets, rest) => distances.flatMap((metres, index) =>
  [swim(metres, offsets[metres]), ...(index < distances.length - 1 ? [pause(rest)] : [])]);
const SWIM_VO2 = { 50: -6, 100: -4, 150: -3, 200: -3, 300: -2, 400: -1 };
const SWIM_CSS = { 100: 0, 200: 1, 300: 1, 400: 2, 500: 2, 600: 3 };

const swimLibrary = [
  ...swimRepeats('swim-vo2-50', 'VO2max 50 m', ['vo2max', 'classic'], '50 m deutlich schneller als CSS (−6 s/100 m), 15 s Pause. Die Anzahl steigt über den Block.', 50, 15, -6, [12, 16, 20], 'VO2max'),
  ...swimRepeats('swim-vo2-75', 'VO2max 75 m', ['vo2max', 'classic'], '75 m bei CSS −5 s/100 m, 20 s Pause.', 75, 20, -5, [8, 10, 12], 'VO2max'),
  ...swimRepeats('swim-vo2-100', 'VO2max 100 m', ['vo2max', 'classic'], '100 m bei CSS −4 s/100 m, 20 s Pause. Gleichmäßig, jede Wiederholung gleich schnell.', 100, 20, -4, [6, 8, 10], 'VO2max'),
  ...swimRepeats('swim-vo2-150', 'VO2max 150 m', ['vo2max', 'classic'], '150 m bei CSS −3 s/100 m, 25 s Pause.', 150, 25, -3, [5, 6, 8], 'VO2max'),
  ...swimRepeats('swim-vo2-200', 'VO2max 200 m', ['vo2max', 'classic'], '200 m bei CSS −3 s/100 m, 30 s Pause.', 200, 30, -3, [4, 5, 6], 'VO2max'),
  ...swimRepeats('swim-vo2-300', 'VO2max 300 m', ['vo2max', 'classic'], 'Lange VO2max-Strecken: 300 m bei CSS −2 s/100 m, 40 s Pause.', 300, 40, -2, [3, 4, 5], 'VO2max'),
  ...swimSeries('swim-vo2-series-50', 'VO2max-Serien 50 m', 50, 10, -6, 90, [4, 5, 6]),
  ...swimSeries('swim-vo2-series-100', 'VO2max-Serien 100 m', 100, 15, -4, 120, [3, 4, 5]),
  ...family('swim-vo2-pyramid', 'swim', 'VO2max-Pyramide', ['vo2max', 'variable'], 'Pyramide von 50 bis 200 m, kurze Strecken schneller (bis CSS −6 s/100 m), 20 s Pause.',
    [[50, 100, 150, 100, 50], [50, 100, 150, 200, 150, 100, 50], [100, 150, 200, 200, 150, 100]].map((stairs, i) => [PHASES[i], `Pyramide ${stairs.join('-')} m`,
      [swimWarm(), ...swimLadder(stairs, SWIM_VO2, 20), swimCool()],
      `${libraryPhases[PHASES[i]].label} Pyramide ${stairs.join('-')} m: 50 m CSS −6 s, 100 m −4 s, 150–200 m −3 s/100 m, 20 s Pause.`])),
  ...family('swim-vo2-ladder', 'swim', 'Absteigende Leiter', ['vo2max', 'progressive'], 'Die Strecken werden kürzer und schneller: von CSS −1 bis −6 s/100 m, 30 s Pause.',
    [[200, 150, 100, 50], [300, 200, 100, 50], [400, 300, 200, 100]].map((stairs, i) => [PHASES[i], `Leiter ${stairs.join('-')} m`,
      [swimWarm(), ...swimLadder(stairs, SWIM_VO2, 30), swimCool()],
      `${libraryPhases[PHASES[i]].label} Leiter ${stairs.join('-')} m, jede Strecke schneller (bis CSS −6 s/100 m), 30 s Pause.`])),
  ...family('swim-vo2-descend', 'swim', 'Descend 4 × 100 m', ['vo2max', 'progressive'], 'Serien aus 4 × 100 m, jede Wiederholung schneller: CSS +2, ±0, −2, −4 s/100 m. 20 s Pause, 1 min Serienpause.',
    [2, 3, 4].map((n, i) => [PHASES[i], `${n} × 4 × 100 m Descend`,
      [swimWarm(), ...series(n, [2, 0, -2].flatMap(offset => [swim(100, offset), pause(20)]).concat(swim(100, -4)), pause(60, 'Serienpause')), swimCool()],
      `${libraryPhases[PHASES[i]].label} Descend: ${n} Serien à 4 × 100 m bei CSS +2 → ±0 → −2 → −4 s/100 m, 20 s Pause, 1 min Serienpause.`])),
  ...family('swim-vo2-broken', 'swim', 'Broken 400 m', ['vo2max', 'variable'], '400 m in 4 × 100 m bei CSS −3 s/100 m mit nur 10 s Pause, 2 min zwischen den Blöcken.',
    [2, 3, 4].map((n, i) => [PHASES[i], `${n} × Broken 400 m`,
      [swimWarm(), ...series(n, [reps(3, swim(100, -3), pause(10)), swim(100, -3)], pause(120, 'Blockpause'), 'Block'), swimCool()],
      `${libraryPhases[PHASES[i]].label} Broken 400: ${n} Blöcke aus 4 × 100 m bei CSS −3 s/100 m mit 10 s Pause, 2 min zwischen den Blöcken.`])),
  ...family('swim-vo2-2525', 'swim', '25/25 Wechsel', ['vo2max', 'variable'], '50-m-Einheiten ohne Pause: 25 m sehr schnell (CSS −8 s), 25 m locker.',
    [8, 12, 16].map((n, i) => [PHASES[i], `${n} × (25 m schnell + 25 m locker)`,
      [swimWarm(), reps(n, swim(25, -8, '25 m schnell'), swim(25, 14, '25 m locker', 'recovery')), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 50 m ohne Pause, jeweils 25 m sehr schnell (CSS −8 s/100 m) und 25 m locker.`])),
  ...swimRepeats('swim-vo2-paddles', 'VO2max mit Paddles', ['vo2max', 'strength'], '100 m mit Paddles bei CSS −3 s/100 m, 20 s Pause. Langer Zug, Ellbogen hoch.', 100, 20, -3, [6, 8, 10], 'Paddles'),
  ...swimRepeats('swim-vo2-racepace', 'Renntempo 50 m (USRPT)', ['vo2max', 'race'], '50 m im Wettkampftempo (CSS −5 s/100 m), 20 s Pause. Abbrechen, wenn das Tempo zweimal nicht mehr gehalten wird.', 50, 20, -5, [16, 20, 24], 'Renntempo'),
  ...swimRepeats('swim-vo2-400', 'VO2max 400 m', ['vo2max', 'classic'], 'Die längste VO2max-Strecke: 400 m bei CSS −2 s/100 m, 1 min Pause.', 400, 60, -2, [2, 3, 4], 'VO2max'),
  ...family('swim-vo2-mix', 'swim', 'VO2max-Mix 200-100-50', ['vo2max', 'variable'], 'Serien aus 200 m (CSS −3 s), 100 m (−4 s) und 50 m (−6 s/100 m), kurze Pausen, 1 min zwischen den Serien.',
    [2, 3, 4].map((n, i) => [PHASES[i], `${n} × (200 + 100 + 50 m)`,
      [swimWarm(), ...series(n, [swim(200, -3), pause(30), swim(100, -4), pause(20), swim(50, -6)], pause(60, 'Serienpause')), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} Serien aus 200 m CSS −3 s, 100 m −4 s und 50 m −6 s/100 m (30 / 20 s Pause), 1 min Serienpause.`])),
  ...family('swim-vo2-finish', 'swim', 'VO2max mit Finish', ['vo2max', 'race'], '200 m ohne Pause: 150 m bei CSS −3 s, die letzten 50 m bei −6 s/100 m. 30 s Pause.',
    [4, 5, 6].map((n, i) => [PHASES[i], `${n} × 200 m mit schnellem Finish`,
      [swimWarm(), reps(n, swim(150, -3), swim(50, -6, 'Finish'), pause(30)), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 200 m, davon 150 m bei CSS −3 s und 50 m Finish bei CSS −6 s/100 m, 30 s Pause.`])),
  ...family('swim-sprint-25', 'swim', 'Sprints 25 m', ['sprint', 'anaerobic'], '25 m maximal mit Startsprung oder Abstoß, 45 s Pause. Volle Qualität, lieber abbrechen als langsamer werden.',
    [6, 8, 10].map((n, i) => [PHASES[i], `${n} × 25 m Sprint`,
      [swimWarm(), reps(n, swim(25, null, '25 m maximal'), pause(45)), swimCool()],
      `${libraryPhases[PHASES[i]].label} Sprints: ${n} × 25 m maximal, 45 s Pause.`])),
  ...swimRepeats('swim-css-50', 'CSS 50 m', ['threshold', 'classic'], '50 m im CSS-Tempo mit nur 5 s Pause. Kurz, aber dicht.', 50, 5, 0, [16, 20, 24], 'CSS'),
  ...swimRepeats('swim-css-100', 'CSS 100 m', ['threshold', 'classic'], 'Der Klassiker: 100 m im CSS-Tempo, 10 s Pause. Die Anzahl steigt über den Block.', 100, 10, 0, [10, 12, 15], 'CSS'),
  ...swimRepeats('swim-css-150', 'CSS 150 m', ['threshold', 'classic'], '150 m bei CSS +1 s/100 m, 15 s Pause.', 150, 15, 1, [6, 8, 10], 'CSS'),
  ...swimRepeats('swim-css-200', 'CSS 200 m', ['threshold', 'classic'], '200 m bei CSS +1 s/100 m, 20 s Pause.', 200, 20, 1, [5, 6, 8], 'CSS'),
  ...swimRepeats('swim-css-300', 'CSS 300 m', ['threshold', 'classic'], '300 m bei CSS +1 s/100 m, 25 s Pause.', 300, 25, 1, [4, 5, 6], 'CSS'),
  ...swimRepeats('swim-css-400', 'CSS 400 m', ['threshold', 'classic'], '400 m bei CSS +2 s/100 m, 30 s Pause. Gleichmäßig einteilen.', 400, 30, 2, [3, 4, 5], 'CSS'),
  ...swimIntervals('swim-css-long', 'CSS lang', ['threshold', 'classic'], 'Lange Schwellenstrecken bei CSS +3 s/100 m, 45 s Pause.', 45, 3, [[2, 600], [2, 800], [3, 800]], 'CSS'),
  ...family('swim-css-continuous', 'swim', 'CSS am Stück', ['threshold', 'long'], 'Durchgehend knapp unter CSS (+3 s/100 m). Gleichmäßig schwimmen, Wenden sauber.',
    [1000, 1500, 2000].map((metres, i) => [PHASES[i], `${metres} m am Stück`, [swimWarm(), swim(metres, 3, 'Am Stück'), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${metres} m am Stück bei CSS +3 s/100 m. Trainiert Tempohärte für Freiwasser und Triathlon.`])),
  ...family('swim-css-pyramid', 'swim', 'CSS-Pyramide', ['threshold', 'variable'], 'Pyramide von 100 bis 500 m um die CSS: kurze Strecken im CSS-Tempo, lange bis CSS +2 s/100 m. 20 s Pause.',
    [[100, 200, 300, 200, 100], [200, 300, 400, 300, 200], [200, 300, 400, 500, 400, 300]].map((stairs, i) => [PHASES[i], `CSS-Pyramide ${stairs.join('-')} m`,
      [swimWarm(), ...swimLadder(stairs, SWIM_CSS, 20), swimCool()],
      `${libraryPhases[PHASES[i]].label} CSS-Pyramide ${stairs.join('-')} m, 100 m bei CSS, 200–300 m +1 s, 400–500 m +2 s/100 m, 20 s Pause.`])),
  ...family('swim-css-ladder', 'swim', 'Aufsteigende Leiter', ['threshold', 'variable'], 'Die Strecken werden länger, das Tempo etwas ruhiger (CSS bis +3 s/100 m). 20 s Pause.',
    [[100, 200, 300, 400], [100, 200, 300, 400, 500], [200, 300, 400, 500, 600]].map((stairs, i) => [PHASES[i], `Leiter ${stairs.join('-')} m`,
      [swimWarm(), ...swimLadder(stairs, SWIM_CSS, 20), swimCool()],
      `${libraryPhases[PHASES[i]].label} Leiter ${stairs.join('-')} m von CSS bis CSS +3 s/100 m, 20 s Pause.`])),
  ...family('swim-css-density', 'swim', 'CSS-Dichte', ['threshold', 'classic'], 'Immer 1200 m bei CSS +1 s/100 m: Strecken werden länger, Pausen kürzer.',
    [[12, 100, 20], [6, 200, 15], [3, 400, 15]].map(([n, metres, rest], i) => [PHASES[i], `${n} × ${metres} m CSS, ${rest} s Pause`,
      [swimWarm(), reps(n, swim(metres, 1), pause(rest)), swimCool()],
      `${libraryPhases[PHASES[i]].label} CSS-Dichte: ${n} × ${metres} m bei CSS +1 s/100 m, ${rest} s Pause. Gleicher Umfang, weniger Erholung.`])),
  ...family('swim-css-broken', 'swim', 'Broken CSS', ['threshold', 'variable'], 'Blöcke aus 200-m-Strecken bei CSS +1 s/100 m mit 10 s Pause, 1 min zwischen den Blöcken.',
    [[2, 3], [2, 4], [3, 4]].map(([n, count], i) => [PHASES[i], `${n} × (${count} × 200 m) Broken`,
      [swimWarm(), ...series(n, [reps(count - 1, swim(200, 1), pause(10)), swim(200, 1)], pause(60, 'Blockpause'), 'Block'), swimCool()],
      `${libraryPhases[PHASES[i]].label} Broken CSS: ${n} Blöcke aus ${count} × 200 m bei CSS +1 s/100 m, 10 s Pause, 1 min zwischen den Blöcken.`])),
  ...family('swim-css-overunder', 'swim', 'CSS Over-Under', ['threshold', 'overunder', 'variable'], '400-m-Blöcke ohne Pause: 50 m schneller (CSS −3 s), 50 m ruhiger (CSS +3 s). 30 s Pause zwischen den Blöcken.',
    [3, 4, 5].map((n, i) => [PHASES[i], `${n} × 400 m Over-Under`,
      [swimWarm(), ...series(n, reps(4, swim(50, -3, 'Over'), swim(50, 3, 'Under')), pause(30), 'Block'), swimCool()],
      `${libraryPhases[PHASES[i]].label} Over-Under: ${n} × 400 m, im Wechsel 50 m bei CSS −3 s und 50 m bei CSS +3 s/100 m, 30 s Pause.`])),
  ...family('swim-css-progressive', 'swim', 'CSS progressiv', ['threshold', 'progressive'], '300 m ohne Pause in drei Stufen: CSS +3, +1 und −1 s/100 m. 30 s Pause.',
    [3, 4, 5].map((n, i) => [PHASES[i], `${n} × 300 m progressiv`,
      [swimWarm(), ...series(n, [swim(100, 3), swim(100, 1), swim(100, -1)], pause(30), 'Intervall'), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 300 m, je 100 m bei CSS +3 → +1 → −1 s/100 m, 30 s Pause.`])),
  ...family('swim-css-negsplit', 'swim', 'Negative Split 400 m', ['threshold', 'progressive'], '400 m ohne Pause: erste Hälfte bei CSS +2 s, zweite Hälfte im CSS-Tempo. 30 s Pause.',
    [3, 4, 5].map((n, i) => [PHASES[i], `${n} × 400 m Negative Split`,
      [swimWarm(), reps(n, swim(200, 2, '1. Hälfte'), swim(200, 0, '2. Hälfte'), pause(30)), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 400 m, 200 m bei CSS +2 s/100 m, dann 200 m im CSS-Tempo, 30 s Pause.`])),
  ...family('swim-css-descend', 'swim', 'Descend 3 × 200 m', ['threshold', 'progressive'], 'Serien aus 3 × 200 m, jede schneller: CSS +3, +1 und −1 s/100 m. 20 s Pause, 1 min Serienpause.',
    [2, 3, 4].map((n, i) => [PHASES[i], `${n} × 3 × 200 m Descend`,
      [swimWarm(), ...series(n, [swim(200, 3), pause(20), swim(200, 1), pause(20), swim(200, -1)], pause(60, 'Serienpause')), swimCool()],
      `${libraryPhases[PHASES[i]].label} Descend: ${n} Serien à 3 × 200 m bei CSS +3 → +1 → −1 s/100 m, 20 s Pause, 1 min Serienpause.`])),
  ...family('swim-css-mix', 'swim', 'CSS-Mix 100-200-300', ['threshold', 'variable'], 'Serien aus 100 m (CSS), 200 m (+1 s) und 300 m (+2 s/100 m), 15 s Pause, 45 s zwischen den Serien.',
    [2, 3, 4].map((n, i) => [PHASES[i], `${n} × (100 + 200 + 300 m)`,
      [swimWarm(), ...series(n, [swim(100, 0), pause(15), swim(200, 1), pause(15), swim(300, 2)], pause(45, 'Serienpause')), swimCool()],
      `${libraryPhases[PHASES[i]].label} CSS-Mix: ${n} Serien aus 100 m CSS, 200 m +1 s und 300 m +2 s/100 m, 15 s Pause, 45 s Serienpause.`])),
  ...swimRepeats('swim-css-pull', 'CSS-Pull', ['threshold', 'classic'], 'Mit Pull Buoy (optional Paddles) bei CSS +2 s/100 m, 20 s Pause. Fokus auf Zugphase und Wasserlage.', 200, 20, 2, [4, 6, 8], 'CSS-Pull'),
  ...family('swim-css-triathlon', 'swim', 'Triathlon-Simulation', ['threshold', 'race'], 'Schneller Start wie im Rennen (200 m bei CSS −3 s), dann ohne Pause im Rennrhythmus (CSS +2 s/100 m).',
    [800, 1000, 1200].map((metres, i) => [PHASES[i], `200 m schnell + ${metres} m Rennrhythmus`,
      [swimWarm(), swim(200, -3, 'Schneller Start'), swim(metres, 2, 'Rennrhythmus'), swimCool()],
      `${libraryPhases[PHASES[i]].label}: 200 m schneller Start (CSS −3 s), dann ${metres} m bei CSS +2 s/100 m ohne Pause. Alle 6–8 Züge nach vorn orientieren.`])),
  ...swimRepeats('swim-tempo-100', 'Tempo 100 m', ['tempo', 'classic'], '100 m zügig bei CSS +5 s/100 m, 10 s Pause.', 100, 10, 5, [10, 15, 20], 'Tempo'),
  ...swimRepeats('swim-tempo-200', 'Tempo 200 m', ['tempo', 'classic'], '200 m zügig bei CSS +5 s/100 m, 15 s Pause.', 200, 15, 5, [6, 8, 10], 'Tempo'),
  ...swimRepeats('swim-tempo-400', 'Tempo 400 m', ['tempo', 'classic'], '400 m bei CSS +5 s/100 m, 20 s Pause.', 400, 20, 5, [3, 4, 5], 'Tempo'),
  ...family('swim-tempo-continuous', 'swim', 'Tempo am Stück', ['tempo', 'long'], 'Durchgehend zügig bei CSS +6 s/100 m. Rhythmus finden und halten.',
    [1200, 1600, 2000].map((metres, i) => [PHASES[i], `${metres} m Tempo am Stück`, [swimWarm(), swim(metres, 6, 'Tempo'), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${metres} m am Stück bei CSS +6 s/100 m.`])),
  ...swimRepeats('swim-tempo-pull', 'Tempo-Pull', ['tempo', 'strength'], '300 m mit Pull Buoy bei CSS +5 s/100 m, 20 s Pause. Kräftiger, langer Zug.', 300, 20, 5, [3, 4, 6], 'Tempo-Pull'),
  ...family('swim-tempo-fartlek', 'swim', 'Schwimm-Fahrtspiel', ['tempo', 'variable'], 'Ohne Pause: 100 m zügig (CSS +5 s), 50 m locker.',
    [4, 6, 8].map((n, i) => [PHASES[i], `${n} × (100 m Tempo + 50 m locker)`,
      [swimWarm(), reps(n, swim(100, 5, '100 m Tempo'), swim(50, 14, '50 m locker', 'recovery')), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 150 m ohne Pause, jeweils 100 m bei CSS +5 s/100 m und 50 m locker.`])),
  ...family('swim-tempo-progressive', 'swim', 'Tempo progressiv', ['tempo', 'progressive'], '400 m ohne Pause, jede 100 m schneller: CSS +8, +6, +4, +2 s/100 m. 30 s Pause.',
    [2, 3, 4].map((n, i) => [PHASES[i], `${n} × 400 m progressiv`,
      [swimWarm(), ...series(n, [8, 6, 4, 2].map(offset => swim(100, offset)), pause(30), 'Intervall'), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 400 m, je 100 m bei CSS +8 → +6 → +4 → +2 s/100 m, 30 s Pause.`])),
  ...family('swim-tempo-css', 'swim', 'Tempo mit CSS-Finish', ['tempo', 'threshold'], '200-m-Strecken im Tempo (CSS +5 s), danach 100 m im CSS-Tempo mit 10 s Pause.',
    [[4, 4], [5, 6], [6, 8]].map(([n, fast], i) => [PHASES[i], `${n} × 200 m Tempo + ${fast} × 100 m CSS`,
      [swimWarm(), reps(n, swim(200, 5), pause(15)), reps(fast, swim(100, 0), pause(10)), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n} × 200 m bei CSS +5 s/100 m (15 s Pause), danach ${fast} × 100 m im CSS-Tempo mit 10 s Pause.`])),
  ...family('swim-base-continuous', 'swim', 'Grundlage am Stück', ['base', 'long'], 'Ruhig und gleichmäßig bei CSS +10 s/100 m. Die Strecke steigt über den Block.',
    [1500, 2000, 2500].map((metres, i) => [PHASES[i], `Grundlage ${metres} m`, [swim(metres, 10, 'Grundlage', 'active')],
      `${libraryPhases[PHASES[i]].label}: ${metres} m am Stück bei CSS +10 s/100 m. Locker atmen, Technik sauber.`])),
  ...swimRepeats('swim-base-400', 'Grundlage 400 m', ['base', 'classic'], '400 m ruhig bei CSS +8 s/100 m, 20 s Pause.', 400, 20, 8, [4, 5, 6], 'Grundlage'),
  ...family('swim-base-technique', 'swim', 'Technik + Grundlage', ['base', 'technique'], 'Technikübungen über 50 m (z. B. Abschlag, Faust, Seitlage), danach 200-m-Strecken bei CSS +10 s/100 m.',
    [[4, 3], [6, 4], [8, 5]].map(([drills, n], i) => [PHASES[i], `${drills} × 50 m Technik + ${n} × 200 m`,
      [swimWarm(), reps(drills, drill(50, 'Technik: Abschlag / Faust / Seitlage'), pause(15)), reps(n, swim(200, 10, '200 m', 'active'), pause(20)), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${drills} × 50 m Technik (15 s Pause), dann ${n} × 200 m bei CSS +10 s/100 m mit 20 s Pause.`])),
  ...swimRepeats('swim-base-pull', 'Pull Buoy Grundlage', ['base', 'strength'], '300 m mit Pull Buoy bei CSS +9 s/100 m, 20 s Pause. Ruhiger, langer Zug.', 300, 20, 9, [4, 5, 6], 'Pull locker'),
  ...family('swim-base-kick', 'swim', 'Beinschlag + Grundlage', ['base', 'technique'], '50 m Beinschlag mit Brett (15 s Pause), danach ruhig am Stück bei CSS +10 s/100 m.',
    [[6, 800], [8, 1000], [10, 1200]].map(([kicks, metres], i) => [PHASES[i], `${kicks} × 50 m Beine + ${metres} m`,
      [swimWarm(), reps(kicks, drill(50, 'Beinschlag mit Brett'), pause(15)), swim(metres, 10, 'Grundlage', 'active'), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${kicks} × 50 m Beinschlag mit Brett, dann ${metres} m am Stück bei CSS +10 s/100 m.`])),
  ...swimRepeats('swim-base-breathing', 'Atemrhythmus', ['base', 'technique'], '100 m ruhig bei CSS +10 s/100 m, im Wechsel 3er- und 5er-Atmung. 15 s Pause.', 100, 15, 10, [8, 10, 12], 'Atemrhythmus'),
  ...family('swim-base-sprints', 'swim', 'Grundlage mit Sprints', ['base', 'sprint'], 'Ruhige Grundlage bei CSS +10 s/100 m, danach kurze 25-m-Sprints mit 40 s Pause.',
    [[1200, 4], [1500, 6], [1800, 8]].map(([metres, n], i) => [PHASES[i], `${metres} m Grundlage + ${n} × 25 m Sprint`,
      [swimWarm(), swim(metres, 10, 'Grundlage', 'active'), reps(n, swim(25, null, '25 m Sprint'), pause(40)), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${metres} m bei CSS +10 s/100 m, dann ${n} × 25 m Sprint mit 40 s Pause. Jeder Sprint mit voller Qualität.`])),
  ...family('swim-base-progressive', 'swim', 'Progressive Grundlage', ['base', 'progressive'], 'Drei lange Strecken, jede etwas schneller: CSS +12, +10 und +8 s/100 m. 20 s Pause.',
    [400, 500, 600].map((metres, i) => [PHASES[i], `3 × ${metres} m progressiv`,
      [swimWarm(200), swim(metres, 12, `${metres} m`, 'active'), pause(20), swim(metres, 10, `${metres} m`, 'active'), pause(20), swim(metres, 8, `${metres} m`, 'active'), swimCool()],
      `${libraryPhases[PHASES[i]].label}: 3 × ${metres} m bei CSS +12 → +10 → +8 s/100 m, 20 s Pause.`])),
  ...family('swim-base-tempo', 'swim', 'Grundlage mit Tempowechsel', ['base', 'tempo', 'long'], 'Ohne Pause: 300 m ruhig (CSS +10 s), 100 m zügig (CSS +5 s/100 m).',
    [4, 5, 6].map((n, i) => [PHASES[i], `${n} × (300 m ruhig + 100 m Tempo)`,
      [swimWarm(200), reps(n, swim(300, 10, '300 m ruhig', 'active'), swim(100, 5, '100 m Tempo')), swimCool()],
      `${libraryPhases[PHASES[i]].label}: ${n * 400} m am Stück, im Wechsel 300 m bei CSS +10 s und 100 m bei CSS +5 s/100 m.`])),
  single('swim-recovery', 'swim', 'Regeneratives Schwimmen', ['recovery'],
    [step('active', { m: 1000 }, 14, 'Sehr locker, Lagen wechseln')],
    '1000 m sehr locker mit wechselnden Lagen und sauberer Technik. Nur durchbewegen.'),
  single('swim-opener', 'swim', 'Aktivierung vor dem Wettkampf', ['race'],
    [swimWarm(), reps(4, swim(50, -3, 'Renntempo'), pause(30)), reps(2, swim(25, null, '25 m Sprint'), pause(60)), swimCool()],
    'Vortag oder Wettkampfmorgen: 4 × 50 m im Renntempo und 2 kurze Sprints. Frisch bleiben, nicht ermüden.'),
  single('swim-css-test', 'swim', 'CSS-Test 400/200 m', ['test', 'threshold'],
    [swimWarm(), swim(400, null, '400 m maximal'), pause(300, 'Locker / Pause'), swim(200, null, '200 m maximal'), swimCool()],
    'CSS pro 100 m = (Zeit 400 m − Zeit 200 m) ÷ 2. Beide Strecken maximal und gleichmäßig schwimmen, Zeiten notieren.'),
];

export const workoutLibrary = [...rideLibrary, ...runLibrary, ...swimLibrary];

const phaseOrder = { start: 0, mid: 1, end: 2 };
export const phaseIndex = phase => phaseOrder[phase];

function expand(spec, visit) {
  spec.forEach(item => item.repeat
    ? Array.from({ length: item.repeat }, () => item.steps.forEach(visit))
    : visit(item));
}

const bounds = target => Array.isArray(target) ? target : [target, target];

function modelTarget(target, sport, { ftp, maxHr }) {
  if (target == null || sport === 'swim') return { type: 'none' };
  const [low, high] = bounds(target);
  if (sport === 'ride') return { type: 'power', low: Math.round(low * ftp / 5) * 5, high: Math.round(high * ftp / 5) * 5 };
  if (!maxHr) return { type: 'none' };
  return { type: 'heart_rate', low: Math.round(low * maxHr), high: Math.round(high * maxHr) };
}

function modelStep(item, sport, athlete) {
  return { kind: 'step', name: item.name, intensity: item.intensity,
    duration: typeof item.duration === 'number' ? { type: 'time', value: item.duration } : { type: 'distance', value: item.duration.m },
    target: modelTarget(item.target, sport, athlete) };
}

export const athleteValues = ({ ftp, maxHr } = {}) => ({ ftp: Number(ftp) > 0 ? Number(ftp) : DEFAULT_FTP, maxHr: Number(maxHr) > 0 ? Number(maxHr) : null });

export function createLibraryWorkout(entry, date, athlete) {
  const values = athleteValues(athlete);
  return { version: 1, name: entry.title, sport: entry.sport, date, notes: entry.description,
    steps: entry.spec.map(item => item.repeat
      ? { kind: 'repeat', count: item.repeat, steps: item.steps.map(s => modelStep(s, entry.sport, values)) }
      : modelStep(item, entry.sport, values)) };
}

// CSS offset in s/100 m → colour zone: CSS itself is the threshold, clearly faster is above it.
const swimZone = offset => offset >= 8 ? 'endurance' : offset >= 4 ? 'tempo' : offset >= -1 ? 'threshold' : 'vo2';

// Profile for the card preview: time-proportional segments with a 0–1 height and the colour zone of work steps.
// Distance steps assume ~4:10 min/km running and ~1:50 min/100 m swimming; open targets fall back to the step type.
export function libraryProfile(entry) {
  const fallback = { warmup: 0.6, cooldown: 0.5, recovery: 0.45, active: 0.7, interval: entry.sport === 'swim' ? 1.6 : 1.2 };
  const segments = [];
  let total = 0;
  expand(entry.spec, item => {
    const seconds = typeof item.duration === 'number' ? item.duration : item.duration.m * (entry.sport === 'swim' ? 1.1 : 0.25);
    const [low, high] = item.target == null ? [fallback[item.intensity], fallback[item.intensity]] : bounds(item.target);
    const level = entry.sport === 'ride' || item.target == null ? (low + high) / 2 / 1.6
      : entry.sport === 'swim' ? (14 - (low + high) / 2) / 22 : ((low + high) / 2 - 0.5) / 0.46;
    const work = item.target != null && ['active', 'interval'].includes(item.intensity);
    const zone = !work ? null : entry.sport === 'swim' ? swimZone((low + high) / 2) : intensityZone((low + high) / 2, entry.sport === 'ride' ? 'power' : 'heart_rate');
    segments.push({ start: total, seconds, intensity: item.intensity, zone, level: Math.min(1, Math.max(0.12, level)) });
    total += seconds;
  });
  return segments.map(s => ({ ...s, x: s.start / total, width: s.seconds / total }));
}

// The hardest target of the session, e.g. "115 % FTP · 290 W" or "CSS −4 s/100 m".
export function libraryKeyTarget(entry, athlete) {
  if (entry.sport === 'swim') {
    let fastest = null;
    expand(entry.spec, item => {
      if (item.target != null && ['active', 'interval'].includes(item.intensity) && (fastest === null || bounds(item.target)[0] < fastest)) fastest = bounds(item.target)[0];
    });
    return fastest === null ? '' : paceText(fastest);
  }
  const values = athleteValues(athlete);
  let key = null;
  expand(entry.spec, item => {
    if (item.target != null && (!key || bounds(item.target)[1] > bounds(key.target)[1])) key = item;
  });
  if (!key) return '';
  const [low, high] = bounds(key.target);
  const percent = low === high ? `${Math.round(low * 100)} %` : `${Math.round(low * 100)}–${Math.round(high * 100)} %`;
  const target = modelTarget(key.target, entry.sport, values);
  const absolute = target.type === 'none' ? '' : ` · ${target.low === target.high ? target.low : `${target.low}–${target.high}`} ${entry.sport === 'ride' ? 'W' : 'bpm'}`;
  return `${percent} ${entry.sport === 'ride' ? 'FTP' : 'HFmax'}${absolute}`;
}

export const librarySummary = (entry, date, athlete) => summary(createLibraryWorkout(entry, date, athlete));

const normalize = text => text.toLowerCase().replace(/ø/g, 'o').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/×/g, 'x').replace(/₂/g, '2');

function haystack(entry) {
  const parts = [entry.title, entry.familyTitle, entry.description, entry.note, { ride: 'rad radfahren bike ride', run: 'laufen lauf run', swim: 'schwimmen swim pool kraul freistil' }[entry.sport],
    ...entry.tags.flatMap(tag => [libraryTags[tag].label, ...libraryTags[tag].terms]),
    ...(entry.phase ? [libraryPhases[entry.phase].label, 'block', ...libraryPhases[entry.phase].terms] : [])];
  const text = normalize(parts.filter(Boolean).join(' '));
  return `${text} ${text.replace(/\s+/g, '')}`;
}

// Every word of the query must match somewhere (title, tags, synonyms, phase).
export function searchLibrary({ query = '', sport, tag = '', phase = '' }, entries = workoutLibrary) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return entries.filter(entry => (!sport || entry.sport === sport) && (!tag || entry.tags.includes(tag)) && (!phase || entry.phase === phase)
    && words.every(word => haystack(entry).includes(word)));
}
