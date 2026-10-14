# Analytics: methods and constants for HRV, RHR, sleep, readiness and strain

Source: noop `docs/ANALYTICS.md` and `docs/DATA_MODEL.md` (https://github.com/ryanbr/noop). These are summarised **methods and constants**, not code. We implement our own Python version (`backend/whoop_analytics.py`). Items marked "not specified" are missing from the source and need our own choice.

## Units
- **Timestamps:** unix seconds.
- **HR:** integer bpm at about 1 Hz.
- **RR:** integer ms. Several RR values can share one `ts`; keep their **arrival order** (`ord`), because ordering by value lowers RMSSD.
- **Gravity x/y/z:** in g.
- **Skin temp, respiration, SpO₂ red/IR:** **raw ADC values**. The docs give no conversion to °C, breaths per minute or %.

## 1. RR cleaning and HRV
- **Cleaning:**
  1. Range filter: keep 300–2000 ms.
  2. Ectopic rejection (Malik 1989): drop a beat if it differs by more than 20 % from the median of a centred 5-beat window (radius 2). Keep edge beats that lack enough neighbours.
  3. Minimum: at least 20 clean beats, otherwise return empty.
- **Formulas:**
  - RMSSD = sqrt(Σ(ΔNN)²/(N−1))
  - SDNN = sample SD (ddof=1)
  - pNN50 = 100·count(|ΔNN|>50)/(N−1)
- **Nightly HRV:** the **mean of the RMSSD values from 5-min tumbling windows** over the whole sleep session.
  - Each window is cleaned separately and is gap-aware.
  - Bins are [t, t+300). The last bin closes at the session end.

## 2. Sleep detection (v1 essentials)
1. **Motion per record:** L2 norm of the change in the gravity vector from the previous record. A record counts as still if this is below 0.01 g.
2. **Window:** a sliding 15-min window. Its centre is "sleep" if at least 70 % of its samples are still.
3. **Runs:** break a run at any data gap over 20 min. Merge runs shorter than 15 min into their neighbours.
4. **Keep a sleep run** only if it lasts more than 60 min **and** its mean HR is at most 1.05 × the day's median HR.
   - Skip the HR check if there are fewer than 30 HR samples.
   - If at least 90 % of the run is posture-stable, use a factor of 1.30. This stops nights with raised HR (fever, alcohol) from being thrown out.
5. **Optional Cole–Kripke** on 30 s epochs, used for sleep onset and final wake:
   - SI = 0.001·Σwᵢ·Aᵢ with weights [106, 54, 58, 76, 230, 74, 67]
   - sleep if SI < 1

**4-class staging is v2.** noop rates it as weak (about 65–73 % epoch agreement; deep sleep is the least reliable).
- **Epochs and features:** 30 s epochs. Features:
  - mean HR
  - difference-of-Gaussians HR variability (σ 120 s minus σ 600 s)
  - RMSSD
  - respiration rate and breath-to-breath variability (RRV)
- **Percentiles:** taken over the sleep epochs.
- **Rules:**
  - Wake: moveFrac ≥ 0.15 and cardiac activation.
  - Deep: moveFrac ≤ 0.10, RMSSD ≥ P70, HR ≤ P25, and regular breathing.
  - REM: still, cardiac activation, and RRV ≥ P65.
  - Light: everything else.
- **Post-processing:**
  - 5-epoch median smoothing
  - no REM in the first 15 min
  - no deep sleep after the first third of the night

## 3. Resting HR
- **Bins:** 5-min non-overlapping bins over the sleep session. A bin counts only with ≥ 5 samples and a mean ≥ 25 bpm.
- **RHR:** the **lowest bin mean**.
- **Fallbacks:** the lowest bin mean regardless of the filters, then the overall mean.
- **Several sleep sessions per day:** use the lowest one.
- **Fallback outside sleep:** the day's 10th-percentile HR (used by the workout detector).

## 4. Recovery / readiness ("Charge")
- **Weights:** HRV 0.55, RHR 0.20, sleep score 0.15, respiration 0.05, skin temp deviation 0.05. Drop missing inputs and **renormalise** the remaining weights to sum to 1.
- **z-scores:** z = (value − baseline)/(1.253·spread).
  - Flip the sign for RHR and respiration, where lower is better.
  - Sleep term: z = (sleepPerf − 0.85)/0.12.
  - Skin temp is a penalty of −|deviation|/scale (scale not specified).
- **Score:** 100/(1+exp(−1.6·(z̄ + 0.20))). z̄ = 0 maps to about 58.
- **Bands:** red < 34, yellow 34–67, green ≥ 67.
- **Baselines (winsorized EWMA):**
  - Smoothing: λ = 1 − 0.5^(1/half-life). Half-life is 14 nights for the baseline and 21 for the spread.
  - Ignore a value more than 5× spread from the baseline.
  - Clamp the value to baseline ± 3× spread before updating the baseline.
  - Update the spread from the **unclamped** deviation, and never let it fall below the floor.
  - Limits and spread floors:

    | Metric | Limits | Spread floor |
    |---|---|---|
    | HRV | 5–250 | 5 |
    | RHR | 30–120 | 2 |
    | Respiration | 4–40 | 0.5 |
    | Skin temp | 20–42 | 0.3 |

  - Alternative: mean/SD over the last 30 nights, divided by 1.253.
- **Cold start:**
  - Fewer than 4 valid nights: no score ("calibrating").
  - 4–13 nights: provisional.
  - 14 or more: trusted.
  - No update for over 14 days: stale.

## 5. Strain ("Effort")
- HRR = HRmax − RHR. Per sample, %HRR = (HR − RHR)/HRR, clamped to 0–100.
- **Edwards TRIMP:** zone weights 1–5 at 50/60/70/80/90 %HRR × time in **minutes**.
- **Banister alternative:** dur·x·0.64·e^(b·x), with b = 1.92 for men and 1.67 for women.
- **Score:** Effort = 100·ln(TRIMP+1)/ln(7201).
  - For WHOOP's 0–21 scale, multiply by 21 instead of 100.
  - Imported 0–21 values are multiplied by 100/21.
- **HRmax:**
  - With at least 600 samples, use the observed 99.5th percentile, but never below Tanaka (208 − 0.7·age).
  - **In TP, `User.max_hr` takes precedence.**
- **Return nothing** with fewer than 600 samples or when HRmax ≤ RHR.

## 6. Sleep score ("Rest") and sleep debt
- **Rest weights:**
  - 0.50 duration vs need (clamped at 100 %)
  - 0.20 efficiency
  - 0.20 (deep+REM)/asleep
  - 0.10 timing consistency (formula not specified)
- **Sleep need:** default 8 h.
- **Sleep debt:** nextDebt = 0.55·max(0, need + debt − asleep), naps included.
  - Under 10 min counts as 0.
  - No positive "bank" builds up.
  - Only the last 14 nights count.
  - The 0.55 was fitted to a single user.

## 7. Workout detection (v2)
- **Per sample:** HR > RHR + 15 **and** motion > 0.20, where motion is a 10 s trailing mean. The scale of that motion value is not specified.
- **Bouts:** at least 5 min; merge bouts separated by gaps under 150 s; keep a bout only if ≥ 50 % of it is in Edwards zone ≥ 2.
- **Calories:** Keytel above RHR + 0.30·HRR, Harris–Benedict below.

## 8. Skin temp, respiration, SpO₂ (v2)
- **Respiration:**
  - Take the raw 1 Hz signal, detrend, find local maxima at least 2 s apart.
  - Keep breath intervals of 1.5–12 s.
  - Rate = 60/median interval; RRV = SD of the intervals.
  - Fairly usable.
- **Skin temp:** the raw → °C conversion is **not documented**. A relative deviation of the raw value against a personal baseline would still work.
- **SpO₂:** noop does **not** compute it from raw red/IR on WHOOP 4. Leave it out.
- **Illness flag:**
  - Compares the last 2 days with a 28-day baseline that ends 3 days earlier.
  - Signals: RHR +5 bpm, HRV −20 %, skin temp +0.6 °C, respiration +1.5/min.
  - Alerts when ≥ 2 signals fire together and there are ≥ 14 days of history.

## 9. Confidence and honesty
- **Tiers:** "calibrating" (no usable baseline or no data), "building" (fewer than about 7 nights or thin data), "solid".
- **No made-up numbers:** show nothing rather than a guessed value.
- **Labels:** every value is an **approximation**, not WHOOP's official score and not a medical device.
- **Known weak spots:** deep sleep, staging in general, the Malik rule (instead of Kubios artifact correction), and RMSSD being the only HRV measure.

## Recommendation for TP v1 (adopted in PLAN.md)
1. Sleep window from gravity stillness plus the HR check, without staging.
2. Nightly RMSSD as the mean of cleaned 5-min windows; nightly RHR as the lowest 5-min mean.
3. Winsorized EWMA baselines for RMSSD and RHR, with the 4/14-night calibration period.
4. Readiness = logistic of the weighted z-scores (HRV 0.55, RHR 0.20, sleep duration vs need 0.15, renormalised), with bands 34/67 and a confidence tier.
5. Strain from Edwards TRIMP with `User.max_hr` and the nightly RHR, on the 0–21 scale. **Not** added into CTL, to avoid double-counting Garmin activities.
6. Sleep duration and sleep debt (0.55 recurrence).
7. Planning rule: readiness red, or HRV below its baseline band together with negative TSB → reduce intensity or swap the session.

**v2:** respiration rate, relative skin temp, illness flag, staging plus the full Rest composite, workout detection, fitting the TRIMP denominator.
