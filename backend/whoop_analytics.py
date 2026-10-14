"""Daily recovery metrics from WHOOP 4.0 samples: sleep, HRV, resting HR, readiness, strain, sleep debt.

Pure functions; whoop_sync.py feeds them decoded samples and stores the results.
Methods and constants: docs/whoop-integration/RESEARCH-ANALYTICS.md (published
methods: RMSSD with Malik ectopic rejection, Edwards TRIMP, logistic z-score).
Every value is an approximation, not a WHOOP score and not a medical measurement.

Two stages:
  nightly_metrics() works on the raw samples of one day (expensive, only for days
  whose data changed): sleep sessions, nightly HRV and RHR, strain.
  score_days() runs over all days in date order (cheap): baselines, readiness,
  confidence and sleep debt, which each depend on the days before.
"""
from bisect import bisect_left, bisect_right
from datetime import datetime, time as clock, timedelta, timezone
from math import exp, log, sqrt
from statistics import fmean, median

VERSION = 1

STILL_G = 0.01            # gravity change between consecutive samples below 10 mg = still
MOTION_MAX_GAP = 60       # no motion value across larger sample gaps
SLEEP_WINDOW = 900        # 15-min window centred on each sample ...
SLEEP_FRACTION = 0.7      # ... sleep if at least 70 % of it is still and worn
WINDOW_MIN_SAMPLES = 30
MAX_GAP = 1200            # a data gap over 20 min ends a run
MIN_SEGMENT = 900         # runs shorter than 15 min merge into their neighbours
MIN_SLEEP = 3600
MIN_SLEEP_HR_SAMPLES = 30
HR_FACTOR, STABLE_HR_FACTOR, STABLE_FRACTION = 1.05, 1.30, 0.9
ASLEEP_MAX_STEP = 60

RR_RANGE = (300, 2000)
MALIK_RADIUS, MALIK_TOLERANCE = 2, 0.2
HRV_BIN, MIN_BEATS, MIN_DIFFS, RR_MAX_STEP = 300, 20, 10, 3
RHR_BIN, RHR_MIN_SAMPLES, RHR_MIN_MEAN = 300, 5, 25

SLEEP_NEED = 480          # minutes
DEBT_FACTOR, DEBT_NIGHTS, DEBT_FLOOR = 0.55, 14, 10

WEIGHTS = {'hrv': 0.55, 'rhr': 0.20, 'sleep': 0.15}
MAD_TO_SD = 1.253
Z_LIMIT = 3
PROVISIONAL, SOLID = 4, 14
BANDS = ((34, 'red'), (67, 'yellow'), (101, 'green'))
LIMITS = {'hrv': (5, 250, 5), 'rhr': (30, 120, 2)}  # lower, upper, spread floor

STRAIN_MIN_SAMPLES = 600
STRAIN_MAX_STEP = 10      # seconds a sample may stand for
EDWARDS = ((90, 5), (80, 4), (70, 3), (60, 2), (50, 1))
TRIMP_SCALE = log(7201)


# ─── Samples ───

def motion_series(ts, gravity):
    """Change of the gravity vector from the previous sample, in g (None across gaps)."""
    result = [None] * len(ts)
    for index in range(1, len(ts)):
        before, after = gravity[index - 1], gravity[index]
        if before and after and 0 < ts[index] - ts[index - 1] <= MOTION_MAX_GAP:
            result[index] = sqrt(sum((a - b) ** 2 for a, b in zip(after, before)))
    return result


def still_and_worn(motion, hr, contact):
    """Candidate sleep samples: still, wearing the strap, with a heart rate.

    A strap lying on a table is perfectly still too; contact and HR rule it out.
    """
    return [value is not None and value < STILL_G and bool(rate) and touch != 0
            for value, rate, touch in zip(motion, hr, contact)]


def sleep_flags(ts, motion, candidate):
    """A sample is asleep when at least 70 % of the known samples in its 15-min window are candidates."""
    known_prefix, candidate_prefix = [0], [0]
    for value, flag in zip(motion, candidate):
        known_prefix.append(known_prefix[-1] + (value is not None))
        candidate_prefix.append(candidate_prefix[-1] + flag)
    flags, low, high, half = [], 0, 0, SLEEP_WINDOW // 2
    for index, moment in enumerate(ts):
        while ts[low] < moment - half:
            low += 1
        while high < len(ts) and ts[high] <= moment + half:
            high += 1
        known = known_prefix[high] - known_prefix[low]
        flags.append(known >= WINDOW_MIN_SAMPLES and candidate_prefix[high] - candidate_prefix[low] >= SLEEP_FRACTION * known)
    return flags


def _segments(ts, flags, start, end):
    """Alternating (asleep, first, last) runs of one gap-free block."""
    runs = []
    for index in range(start, end):
        if runs and runs[-1][0] == flags[index]:
            runs[-1][2] = index
        else:
            runs.append([flags[index], index, index])
    return runs


def _smooth(ts, runs):
    """Short wake runs between sleep become sleep; short sleep runs become wake; then merge."""
    duration = lambda run: ts[run[2]] - ts[run[1]]  # noqa: E731
    for asleep in (False, True):
        for position, run in enumerate(runs):
            inner = 0 < position < len(runs) - 1 or asleep
            if run[0] == asleep and inner and duration(run) < MIN_SEGMENT:
                run[0] = not asleep
        merged = []
        for run in runs:
            if merged and merged[-1][0] == run[0]:
                merged[-1][2] = run[2]
            else:
                merged.append(run)
        runs = merged
    return runs


def sleep_sessions(ts, hr, motion, candidate, flags):
    """Sleep sessions as dicts with start, end (unix), asleep and in-bed seconds and sample index range."""
    blocks, start = [], 0
    for index in range(1, len(ts) + 1):
        if index == len(ts) or ts[index] - ts[index - 1] > MAX_GAP:
            if start < index:
                blocks.append((start, index))
            start = index
    sessions = []
    rates = [(moment, rate) for moment, rate in zip(ts, hr) if rate]
    rate_times = [moment for moment, _ in rates]
    for block_start, block_end in blocks:
        for asleep, first, last in _smooth(ts, _segments(ts, flags, block_start, block_end)):
            if not asleep or ts[last] - ts[first] < MIN_SLEEP:
                continue
            run_rates = [rate for rate in hr[first:last + 1] if rate]
            if len(run_rates) < MIN_SLEEP_HR_SAMPLES:
                continue
            day = [rate for _, rate in rates[bisect_left(rate_times, ts[last] - 86400):bisect_right(rate_times, ts[last])]]
            known = [flag for value, flag in zip(motion[first:last + 1], candidate[first:last + 1]) if value is not None]
            stable = known and sum(known) / len(known) >= STABLE_FRACTION
            if fmean(run_rates) > (STABLE_HR_FACTOR if stable else HR_FACTOR) * median(day):
                continue
            asleep_seconds = sum(min(ts[i + 1] - ts[i], ASLEEP_MAX_STEP) for i in range(first, last) if flags[i])
            sessions.append({'start': ts[first], 'end': ts[last] + 1, 'asleep': asleep_seconds,
                             'inBed': ts[last] + 1 - ts[first], 'first': first, 'last': last})
    return sessions


# ─── HRV and resting HR ───

def clean_beats(beats):
    """Range filter, then Malik: drop a beat more than 20 % off its centred 5-beat median.

    beats: [(ts, ms)] in arrival order. Returns keep flags for the input order.
    """
    valid = [index for index, (_, ms) in enumerate(beats) if RR_RANGE[0] <= ms <= RR_RANGE[1]]
    keep = [False] * len(beats)
    for position, index in enumerate(valid):
        keep[index] = True
        if MALIK_RADIUS <= position < len(valid) - MALIK_RADIUS:
            window = [beats[valid[p]][1] for p in range(position - MALIK_RADIUS, position + MALIK_RADIUS + 1)]
            centre = median(window)
            if abs(beats[index][1] - centre) > MALIK_TOLERANCE * centre:
                keep[index] = False
    return keep


def rmssd(beats):
    """RMSSD over successive clean beats that were also neighbours in the recording (gap-aware)."""
    keep = clean_beats(beats)
    differences = [beats[i][1] - beats[i - 1][1] for i in range(1, len(beats))
                   if keep[i] and keep[i - 1] and beats[i][0] - beats[i - 1][0] <= RR_MAX_STEP]
    if sum(keep) < MIN_BEATS or len(differences) < MIN_DIFFS:
        return None
    return sqrt(fmean(difference * difference for difference in differences))


def nightly_hrv(rr, start, end):
    """Mean RMSSD of the 5-min tumbling windows [t, t+300) of a sleep session.

    rr: [(ts, order, ms)] sorted by (ts, order), i.e. arrival order.
    """
    values, bin_start = [], start
    times = [beat[0] for beat in rr]
    while bin_start < end:
        bin_end = min(bin_start + HRV_BIN, end)
        beats = [(ts, ms) for ts, _, ms in rr[bisect_left(times, bin_start):bisect_left(times, bin_end)]]
        value = rmssd(beats)
        if value is not None:
            values.append(value)
        bin_start = bin_end
    return (fmean(values), len(values)) if values else (None, 0)


def resting_hr(ts, hr, start, end):
    """Lowest 5-min mean HR in a session (bins with >= 5 samples and a mean >= 25); else the lowest of any bin."""
    bins = {}
    for moment, rate in zip(ts, hr):
        if rate and start <= moment < end:
            bins.setdefault((moment - start) // RHR_BIN, []).append(rate)
    means = [(fmean(rates), len(rates)) for rates in bins.values()]
    strict = [mean for mean, count in means if count >= RHR_MIN_SAMPLES and mean >= RHR_MIN_MEAN]
    return min(strict or [mean for mean, _ in means], default=None)


# ─── Strain ───

def hr_max(max_hr=None, age=None):
    """The athlete's HFmax from the profile; otherwise Tanaka (208 - 0.7 x age)."""
    if max_hr:
        return float(max_hr)
    return 208 - 0.7 * age if age else None


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * len(ordered)))] if ordered else None


def strain(ts, hr, maximum, resting=None):
    """Edwards TRIMP (zone weights 1-5 at 50/60/70/80/90 %HRR x minutes) and strain 0-21."""
    samples = [(moment, rate) for moment, rate in zip(ts, hr) if rate]
    if len(samples) < STRAIN_MIN_SAMPLES or not maximum:
        return None
    resting = resting or percentile([rate for _, rate in samples], 0.10)
    reserve = maximum - resting
    if reserve <= 0:
        return None
    trimp = 0.0
    for (moment, rate), following in zip(samples, samples[1:] + [None]):
        step = min(following[0] - moment, STRAIN_MAX_STEP) if following else 1
        percent = max(0.0, min(100.0, (rate - resting) / reserve * 100))
        weight = next((weight for threshold, weight in EDWARDS if percent >= threshold), 0)
        trimp += weight * step / 60
    return {'trimp': round(trimp, 1), 'strain': round(21 * log(trimp + 1) / TRIMP_SCALE, 1),
            'hrMax': round(maximum), 'restingHr': round(resting)}


# ─── One day ───

def local_bounds(day, zone):
    start = datetime.combine(day, clock(0), zone)
    return int(start.timestamp()), int((start + timedelta(days=1)).timestamp())


def analysis_window(day, zone):
    """Unix range whose samples a day needs: sleep ending that day plus sliding-window margin."""
    start, end = local_bounds(day, zone)
    return start - 12 * 3600, end + 3600


def nightly_metrics(day, zone, series, maximum):
    """Stage 1 for one local date. series: sorted columns ts, hr, gravity, contact and rr.

    Sleep sessions belong to the date they end on. HRV comes from the longest one,
    RHR is the lowest of all sessions. Strain covers the local calendar day.
    """
    ts, hr = series['ts'], series['hr']
    if not ts:
        return None
    motion = motion_series(ts, series['gravity'])
    candidate = still_and_worn(motion, hr, series['contact'])
    flags = sleep_flags(ts, motion, candidate)
    day_start, day_end = local_bounds(day, zone)
    sessions = [session for session in sleep_sessions(ts, hr, motion, candidate, flags) if day_start <= session['end'] - 1 < day_end]
    result = {'version': VERSION, 'sleep': None, 'hrv': None, 'hrvWindows': 0, 'rhr': None, 'strain': None}
    if sessions:
        main = max(sessions, key=lambda session: session['asleep'])
        hrv, windows = nightly_hrv(series['rr'], main['start'], main['end'])
        rates = [resting_hr(ts, hr, session['start'], session['end']) for session in sessions]
        rates = [rate for rate in rates if rate is not None]
        result.update(
            sleep={'start': main['start'], 'end': main['end'], 'minutes': round(sum(s['asleep'] for s in sessions) / 60),
                   'inBedMinutes': round(main['inBed'] / 60), 'efficiency': round(main['asleep'] / main['inBed'], 3),
                   'sessions': len(sessions)},
            hrv=round(hrv, 1) if hrv is not None else None, hrvWindows=windows,
            rhr=round(min(rates), 1) if rates else None)
    low, high = bisect_left(ts, day_start), bisect_left(ts, day_end)
    result['strain'] = strain(ts[low:high], hr[low:high], maximum, result['rhr'])
    if result['sleep'] is None and result['strain'] is None:
        return None
    return result


# ─── Baselines and readiness ───

class Baseline:
    """Winsorized EWMA of a nightly value and of its mean absolute deviation (spread).

    The first four accepted nights start it with their plain mean and deviation.
    After that: values more than 5 spreads away are ignored, the mean moves toward
    the value clamped to 3 spreads (half-life 14 nights), the spread toward the
    unclamped deviation (half-life 21), never below its floor.
    """

    def __init__(self, metric, half_life=14, spread_half_life=21):
        self.lower, self.upper, self.floor = LIMITS[metric]
        self.rate = 1 - 0.5 ** (1 / half_life)
        self.spread_rate = 1 - 0.5 ** (1 / spread_half_life)
        self.values = []
        self.mean = self.spread = None
        self.nights = 0

    def snapshot(self):
        if self.mean is None:
            return None
        return {'mean': round(self.mean, 1), 'spread': round(self.spread, 1), 'nights': self.nights,
                'low': round(self.mean - MAD_TO_SD * self.spread, 1), 'high': round(self.mean + MAD_TO_SD * self.spread, 1)}

    def z(self, value):
        if value is None or self.mean is None:
            return None
        return max(-Z_LIMIT, min(Z_LIMIT, (value - self.mean) / (MAD_TO_SD * self.spread)))

    def add(self, value):
        if value is None or not self.lower <= value <= self.upper:
            return False
        if self.nights < PROVISIONAL:
            self.values.append(value)
            self.mean = fmean(self.values)
            self.spread = max(self.floor, fmean(abs(v - self.mean) for v in self.values))
        else:
            deviation = value - self.mean
            if abs(deviation) > 5 * self.spread:
                return False
            clamped = max(self.mean - 3 * self.spread, min(self.mean + 3 * self.spread, value))
            self.mean += self.rate * (clamped - self.mean)
            self.spread = max(self.floor, self.spread + self.spread_rate * (abs(deviation) - self.spread))
        self.nights += 1
        return True


def band(score):
    return next(name for limit, name in BANDS if score < limit)


def confidence(nights):
    return 'calibrating' if nights < PROVISIONAL else 'provisional' if nights < SOLID else 'solid'


def readiness(hrv_z, rhr_z, sleep_minutes, nights):
    """Logistic score 0-100 of the weighted z-scores; weights renormalised over what is present."""
    if nights < PROVISIONAL or (hrv_z is None and rhr_z is None):
        return None
    terms = {'hrv': hrv_z, 'rhr': None if rhr_z is None else -rhr_z}
    if sleep_minutes is not None:
        terms['sleep'] = max(-Z_LIMIT, min(Z_LIMIT, (min(1.0, sleep_minutes / SLEEP_NEED) - 0.85) / 0.12))
    present = {key: value for key, value in terms.items() if value is not None}
    mean_z = sum(WEIGHTS[key] * value for key, value in present.items()) / sum(WEIGHTS[key] for key in present)
    return round(100 / (1 + exp(-1.6 * (mean_z + 0.2))))


def sleep_debt(minutes_by_day, day):
    """nextDebt = 0.55 x max(0, need + debt - asleep) over the last 14 nights; nights without data are skipped."""
    debt = 0.0
    for offset in range(DEBT_NIGHTS - 1, -1, -1):
        asleep = minutes_by_day.get(day - timedelta(days=offset))
        if asleep is not None:
            debt = DEBT_FACTOR * max(0.0, SLEEP_NEED + debt - asleep)
            debt = 0.0 if debt < DEBT_FLOOR else debt
    return round(debt)


def score_days(nightly_by_day):
    """Stage 2 over all days in date order. Today is compared with the baseline before today."""
    hrv_base, rhr_base = Baseline('hrv'), Baseline('rhr')
    minutes = {day: values['sleep']['minutes'] for day, values in nightly_by_day.items() if values and values.get('sleep')}
    scores = {}
    for day in sorted(nightly_by_day):
        values = nightly_by_day[day] or {}
        hrv, rhr = values.get('hrv'), values.get('rhr')
        nights = hrv_base.nights
        hrv_reference, rhr_reference = hrv_base.snapshot(), rhr_base.snapshot()
        hrv_z = hrv_base.z(hrv) if hrv_base.nights >= PROVISIONAL else None
        rhr_z = rhr_base.z(rhr) if rhr_base.nights >= PROVISIONAL else None
        score = readiness(hrv_z, rhr_z, minutes.get(day), nights)
        hrv_base.add(hrv)
        rhr_base.add(rhr)
        scores[day] = {'readiness': score, 'band': band(score) if score is not None else None,
                       'confidence': confidence(nights), 'nights': hrv_base.nights,
                       'hrvBaseline': hrv_reference, 'rhrBaseline': rhr_reference,
                       'hrvZ': None if hrv_z is None else round(hrv_z, 2), 'rhrZ': None if rhr_z is None else round(rhr_z, 2),
                       'sleepDebtMinutes': sleep_debt(minutes, day) if day in minutes else None}
    return scores


def utc_iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')
