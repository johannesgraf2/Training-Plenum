// Example sessions for the workout builder. Cycling targets are fractions of FTP,
// running targets fractions of maximum heart rate; `create` turns them into a
// normal editable workout with watts / bpm for the current athlete.
import { summary } from './workoutModel';

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
  test: { label: 'Test', terms: ['ftp-test', 'leistungstest', 'field test'] },
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

const family = (key, sport, familyTitle, tags, note, variants) => variants.map(([phase, title, spec, description]) =>
  ({ id: `${key}-${phase}`, family: key, familyTitle, note, sport, phase, title, tags, description, spec }));
const single = (id, sport, title, tags, spec, description) => ({ id, sport, title, tags, description, spec });

const PHASES = ['start', 'mid', 'end'];
const PYRAMID = { 1: 1.25, 2: 1.2, 3: 1.15, 4: 1.1, 5: 1.1 };
const percent = fraction => `${Math.round(fraction * 100)} %`;
const clockText = seconds => seconds % 60 ? `${seconds} s` : `${seconds / 60} min`;

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

// Steady threshold intervals, 5 min easy; `variants` are [count, minutes, target] for start, middle and end.
const steadyFamily = (key, familyTitle, tags, note, variants, name = 'Schwelle') => family(key, 'ride', familyTitle, tags, note,
  variants.map(([n, minutes, target], i) => [PHASES[i], `${n} × ${minutes} min ${name}`,
    [warm(), reps(n, step('interval', min(minutes), target, name), spin(min(5))), cool()],
    `${libraryPhases[PHASES[i]].label} ${familyTitle}: ${n} × ${minutes} min bei ${targetText(target)} FTP, 5 min locker.`]));

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
  ...steadyFamily('ride-threshold-12', 'Schwelle 12 min', ['threshold', 'classic'], 'Intervalle bei 98–100 % FTP, 5 min locker. Erst mehr Wiederholungen, dann längere Intervalle.',
    [[3, 12, [0.98, 1]], [4, 12, [0.98, 1]], [4, 15, [0.98, 1]]]),
  ...steadyFamily('ride-threshold-15', 'Schwelle 15 min', ['threshold', 'classic'], 'Längere Intervalle knapp um FTP, 5 min locker. Bei mehr Umfang etwas defensiver starten.',
    [[2, 15, 1], [3, 15, [0.98, 1]], [4, 15, [0.95, 1]]]),
  ...steadyFamily('ride-threshold-20', 'Schwelle 20 min', ['threshold', 'classic'], 'Klassische lange FTP-Intervalle bei 95–100 % FTP, 5 min locker. Am Ende länger statt mehr.',
    [[2, 20, [0.95, 1]], [3, 20, [0.95, 1]], [2, 30, [0.95, 1]]]),
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
  single('ride-base-sprints', 'ride', 'Grundlage mit Sprints', ['base', 'sprint'],
    [step('active', min(20), 0.62, 'Grundlage'), reps(6, step('interval', 10, [1.8, 2.5], 'Sprint'), step('active', 290, 0.62, 'Grundlage')), step('active', min(40), 0.65, 'Grundlage')],
    'Grundlage 90 min mit 6 × 10 s Sprint alle 5 min. Hält die Spitzenleistung in Grundlagenphasen wach.'),
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
  single('run-easy-strides', 'run', 'Lockerer Lauf mit Steigerungen', ['base', 'sprint'],
    [step('active', min(40), [0.65, 0.75], 'Locker'), reps(6, step('interval', 20, null, 'Steigerung'), step('recovery', 100, null, 'Locker gehen/traben')), step('cooldown', min(5), [0.6, 0.72], 'Auslaufen')],
    '40 min locker, dann 6 × 20 s Steigerungsläufe bis ~95 % Tempo. Locker und technisch sauber.'),
  single('run-easy-45', 'run', 'Lockerer Lauf 45 min', ['base'],
    [step('active', min(45), [0.65, 0.75], 'Locker')],
    '45 min locker bei 65–75 % HFmax.'),
  single('run-recovery', 'run', 'Regenerationslauf 30 min', ['recovery'],
    [step('active', min(30), [0.6, 0.7], 'Sehr locker')],
    '30 min sehr locker unter 70 % HFmax. Gehpausen sind erlaubt.'),
  single('run-fartlek', 'run', 'Fahrtspiel 10 × 1 min', ['tempo', 'vo2max'],
    [runWarm(), reps(10, step('interval', min(1), [0.85, 0.92], 'Zügig'), step('recovery', min(1), [0.65, 0.75], 'Locker')), runCool()],
    'Fahrtspiel: 10 × 1 min zügig / 1 min locker weiterlaufen.'),
  single('run-pyramid', 'run', 'Pyramide 400-800-1200-800-400 m', ['vo2max', 'threshold'],
    [runWarm(), ...[400, 800, 1200, 800, 400].flatMap((metres, index, all) => [step('interval', { m: metres }, [0.88, 0.95], `${metres} m`), ...(index < all.length - 1 ? [jog({ m: 200 })] : [])]), runCool()],
    'Pyramide 400-800-1200-800-400 m bei 88–95 % HFmax, je 200 m Trabpause.'),
  single('run-opener', 'run', 'Aktivierung vor dem Wettkampf', ['race'],
    [runWarm(15), reps(4, step('interval', min(1), [0.85, 0.9], 'Renntempo'), jog(min(1))), runCool(7)],
    'Vortag des Wettkampfs: 4 × 1 min im geplanten Renntempo. Kurz und frisch.'),
];

export const workoutLibrary = [...rideLibrary, ...runLibrary];

const phaseOrder = { start: 0, mid: 1, end: 2 };
export const phaseIndex = phase => phaseOrder[phase];

function expand(spec, visit) {
  spec.forEach(item => item.repeat
    ? Array.from({ length: item.repeat }, () => item.steps.forEach(visit))
    : visit(item));
}

const bounds = target => Array.isArray(target) ? target : [target, target];

function modelTarget(target, sport, { ftp, maxHr }) {
  if (target == null) return { type: 'none' };
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

// Profile for the card preview: time-proportional segments with a 0–1 height.
// Distance steps assume ~4:10 min/km; open targets fall back to the step type.
export function libraryProfile(entry) {
  const fallback = { warmup: 0.6, cooldown: 0.5, recovery: 0.45, active: 0.7, interval: 1.2 };
  const segments = [];
  let total = 0;
  expand(entry.spec, item => {
    const seconds = typeof item.duration === 'number' ? item.duration : item.duration.m / 4;
    const [low, high] = item.target == null ? [fallback[item.intensity], fallback[item.intensity]] : bounds(item.target);
    const level = entry.sport === 'ride' || item.target == null ? (low + high) / 2 / 1.6 : ((low + high) / 2 - 0.5) / 0.46;
    segments.push({ start: total, seconds, intensity: item.intensity, level: Math.min(1, Math.max(0.12, level)) });
    total += seconds;
  });
  return segments.map(s => ({ ...s, x: s.start / total, width: s.seconds / total }));
}

// The hardest target of the session, e.g. "115 % FTP · 290 W".
export function libraryKeyTarget(entry, athlete) {
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
  const parts = [entry.title, entry.familyTitle, entry.description, entry.note, entry.sport === 'ride' ? 'rad radfahren bike ride' : 'laufen lauf run',
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
