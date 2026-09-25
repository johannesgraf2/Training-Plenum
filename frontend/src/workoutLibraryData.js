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
  overunder: { label: 'Over-Under', terms: ['over under', 'overunder', 'wechsel'] },
  tempo: { label: 'Tempo', terms: ['z3', 'tempodauerlauf', 'fahrtspiel', 'fartlek'] },
  base: { label: 'Grundlage', terms: ['base', 'endurance', 'ga1', 'z2', 'zone 2', 'grundlagenausdauer', 'lit', 'locker'] },
  long: { label: 'Lang', terms: ['long', 'langer lauf', 'lange ausfahrt'] },
  recovery: { label: 'Regeneration', terms: ['recovery', 'reko', 'easy', 'erholung'] },
  micro: { label: 'Mikrointervalle', terms: ['micro', '30/15', '40/20', '30/30', 'ronnestad', 'rønnestad'] },
  sprint: { label: 'Sprint', terms: ['neuromuskulär', 'strides', 'steigerungen', 'steigerungsläufe'] },
  anaerobic: { label: 'Anaerob', terms: ['anaerobic', 'sit', 'z6', 'laktat'] },
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
// Series of short repeats: one repeat block per series, so the FIT file needs no nested repeats.
const series = (count, block, rest) => Array.from({ length: count }, (_, index) => [
  { ...block, steps: block.steps.map(s => ({ ...s, name: `Serie ${index + 1} · ${s.name}` })) },
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

const rideLibrary = [
  ...family('ride-vo2-4', 'ride', 'VO2max 4 min', ['vo2max'], '4-min-Intervalle bei ~115 % FTP, 4 min locker. Umfang steigt über den Block.', [
    ['start', '3 × 4 min VO2max', [warm(), reps(3, step('interval', min(4), 1.15, 'VO2max'), spin(min(4))), cool()],
      'Block-Start VO2max: 3 × 4 min bei ~115 % FTP. Gleichmäßig fahren, die letzte Wiederholung soll noch sauber gelingen.'],
    ['mid', '4 × 4 min VO2max', [warm(), reps(4, step('interval', min(4), 1.15, 'VO2max'), spin(min(4))), cool()],
      'Block-Mitte VO2max: 4 × 4 min bei ~115 % FTP. Eine Wiederholung mehr bei gleicher Leistung.'],
    ['end', '6 × 4 min VO2max', [warm(), reps(6, step('interval', min(4), 1.15, 'VO2max'), spin(min(4))), cool()],
      'Block-Ende VO2max: 6 × 4 min bei ~115 % FTP. Höchster Umfang im Block; bei Leistungsabfall eher Watt als Wiederholungen streichen.'],
  ]),
  ...family('ride-vo2-3015', 'ride', 'VO2max 30/15', ['vo2max', 'micro'], 'Serien aus 30 s hart / 15 s locker, 5 min Serienpause. Wiederholungen je Serie steigen.', [
    ['start', '2 × 10 × 30/15 s', [warm(20), ...series(2, reps(10, step('interval', 30, 1.25, 'Belastung'), step('recovery', 15, 0.5, 'Pause')), spin(min(5), 'Serienpause')), cool()],
      'Block-Start 30/15: 2 Serien à 10 × 30 s bei ~125 % FTP / 15 s locker, 5 min Serienpause.'],
    ['mid', '3 × 11 × 30/15 s', [warm(20), ...series(3, reps(11, step('interval', 30, 1.25, 'Belastung'), step('recovery', 15, 0.5, 'Pause')), spin(min(5), 'Serienpause')), cool()],
      'Block-Mitte 30/15: 3 Serien à 11 × 30 s bei ~125 % FTP / 15 s locker, 5 min Serienpause.'],
    ['end', '3 × 13 × 30/15 s', [warm(20), ...series(3, reps(13, step('interval', 30, 1.25, 'Belastung'), step('recovery', 15, 0.5, 'Pause')), spin(min(5), 'Serienpause')), cool()],
      'Block-Ende 30/15: 3 Serien à 13 × 30 s bei ~125 % FTP / 15 s locker, 5 min Serienpause.'],
  ]),
  ...family('ride-vo2-4020', 'ride', 'VO2max 40/20', ['vo2max', 'micro'], 'Serien aus 40 s hart / 20 s locker, 5 min Serienpause.', [
    ['start', '2 × 8 × 40/20 s', [warm(), ...series(2, reps(8, step('interval', 40, 1.2, 'Belastung'), step('recovery', 20, 0.5, 'Pause')), spin(min(5), 'Serienpause')), cool()],
      'Block-Start 40/20: 2 Serien à 8 × 40 s bei ~120 % FTP / 20 s locker.'],
    ['mid', '3 × 8 × 40/20 s', [warm(), ...series(3, reps(8, step('interval', 40, 1.2, 'Belastung'), step('recovery', 20, 0.5, 'Pause')), spin(min(5), 'Serienpause')), cool()],
      'Block-Mitte 40/20: 3 Serien à 8 × 40 s bei ~120 % FTP / 20 s locker.'],
    ['end', '3 × 10 × 40/20 s', [warm(), ...series(3, reps(10, step('interval', 40, 1.2, 'Belastung'), step('recovery', 20, 0.5, 'Pause')), spin(min(5), 'Serienpause')), cool()],
      'Block-Ende 40/20: 3 Serien à 10 × 40 s bei ~120 % FTP / 20 s locker.'],
  ]),
  ...family('ride-threshold', 'ride', 'Schwelle', ['threshold'], 'Lange Intervalle knapp unter FTP, 5 min locker. Zeit an der Schwelle steigt.', [
    ['start', '3 × 10 min Schwelle', [warm(), reps(3, step('interval', min(10), 0.97, 'Schwelle'), spin(min(5))), cool()],
      'Block-Start Schwelle: 3 × 10 min bei ~97 % FTP, 5 min locker dazwischen.'],
    ['mid', '3 × 12 min Schwelle', [warm(), reps(3, step('interval', min(12), 0.98, 'Schwelle'), spin(min(5))), cool()],
      'Block-Mitte Schwelle: 3 × 12 min bei ~98 % FTP, 5 min locker dazwischen.'],
    ['end', '2 × 20 min Schwelle', [warm(), reps(2, step('interval', min(20), 0.97, 'Schwelle'), spin(min(5))), cool()],
      'Block-Ende Schwelle: 2 × 20 min bei ~97 % FTP. Konstant bleiben, nicht mit zu viel Druck anfahren.'],
  ]),
  ...family('ride-overunder', 'ride', 'Over-Under', ['threshold', 'overunder'], 'Wechsel 2 min unter / 1 min über FTP in drei Serien, 5 min Serienpause.', [
    ['start', '3 × 9 min Over-Under', [warm(), ...series(3, reps(3, step('interval', min(2), 0.95, 'Under'), step('interval', min(1), 1.08, 'Over')), spin(min(5), 'Serienpause')), cool()],
      'Block-Start Over-Under: 3 Serien à 3 × (2 min ~95 % / 1 min ~108 % FTP), 5 min Serienpause.'],
    ['mid', '3 × 12 min Over-Under', [warm(), ...series(3, reps(4, step('interval', min(2), 0.95, 'Under'), step('interval', min(1), 1.08, 'Over')), spin(min(5), 'Serienpause')), cool()],
      'Block-Mitte Over-Under: 3 Serien à 4 × (2 min ~95 % / 1 min ~108 % FTP), 5 min Serienpause.'],
    ['end', '3 × 15 min Over-Under', [warm(), ...series(3, reps(5, step('interval', min(2), 0.95, 'Under'), step('interval', min(1), 1.08, 'Over')), spin(min(5), 'Serienpause')), cool()],
      'Block-Ende Over-Under: 3 Serien à 5 × (2 min ~95 % / 1 min ~108 % FTP), 5 min Serienpause.'],
  ]),
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
  single('ride-vo2-pyramid', 'ride', 'VO2max-Pyramide 1-2-3-4-3-2-1', ['vo2max', 'anaerobic'],
    [warm(), ...[1, 2, 3, 4, 3, 2, 1].flatMap((minutes, index, all) => [step('interval', min(minutes), minutes <= 2 ? 1.2 : 1.12, `${minutes} min`), ...(index < all.length - 1 ? [spin(min(minutes))] : [])]), cool()],
    'Pyramide 1-2-3-4-3-2-1 min: kurze Stufen ~120 %, lange ~112 % FTP, Pause so lang wie das Intervall davor.'),
  single('ride-3030', 'ride', '2 × 12 × 30/30 s', ['vo2max', 'micro'],
    [warm(), ...series(2, reps(12, step('interval', 30, 1.2, 'Belastung'), step('recovery', 30, 0.5, 'Pause')), spin(min(6), 'Serienpause')), cool()],
    '30/30: 2 Serien à 12 × 30 s bei ~120 % FTP / 30 s locker, 6 min Serienpause. Guter Einstieg in VO2max-Arbeit.'),
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

const normalize = text => text.toLowerCase().replace(/ø/g, 'o').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/×/g, 'x');

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
