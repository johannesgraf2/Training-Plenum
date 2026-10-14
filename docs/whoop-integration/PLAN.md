# WHOOP 4.0 directly in Training Plenum: implementation plan

Status: **phases 1–3 implemented, not yet tested on the real strap** (as of 2026-10-14; deviations are listed in START-HERE.md). Research details are in the `RESEARCH-*.md` files in this folder.

## Context
Johannes wants to use his WHOOP 4.0 without the official WHOOP app and without the noop app. Training Plenum (TP) stays the **only interface**. Recovery, HRV, resting HR, sleep and strain should appear right next to training planning (calendar, Today, Dashboard, AI coach), so plans get better.

TP runs on a Mac at home. Docker on macOS cannot access Bluetooth, so a small **headless Bluetooth bridge** runs on the Mac host. It has no UI: it holds the strap connection and delivers data to TP. Setup, status and every view of the data live inside TP. UI strings stay German to match the app.

Legal: noop (https://github.com/ryanbr/noop) is under PolyForm Noncommercial. Its LICENSE explicitly frees protocol facts (UUIDs, frame layouts, CRCs, command numbers, offsets). We write our own Python from those facts and copy no noop code. The analytics use published methods (RMSSD, Edwards TRIMP, logistic z-score).

## Architecture

```
WHOOP 4.0 ──BLE──▶ whoop-bridge (Mac host, launchd, no UI)
                     │ local SQLite outbox (raw frames) → only then trim-ACK to the strap
                     │ HTTP (localhost, bearer token), gzip batches
                     ▼
              TP backend (Docker): whoop_sync.py
                     ├ decodes frames → hourly sample chunks
                     ├ whoop_analytics.py → whoop_day (readiness, HRV, RHR, sleep, strain)
                     └ /api/whoop/*  →  React: WHOOP modal, Today tile, calendar, dashboard, coach
```

The bridge ships raw frames and the backend decodes them. That way decoder fixes ship with TP, with no bridge reinstall, and the raw frames TP keeps can be reprocessed.

## New files

**`backend/whoop_protocol.py`**: pure Python, no dependencies, shared by the bridge and the backend.
- **Framing:**
  - CRC8 (SMBUS: poly 0x07, init 0, not reflected) over bytes [1..2]
  - zlib CRC32 over `frame[4:len]`
  - `build_command(cmd, seq, body)`, `parse_frame()`
  - `Reassembler` that resyncs on 0xAA, capped at 8192 bytes
- **Packet types:** 35 cmd, 36 resp, 40 realtime HR, 43 raw, 47 history, 48 event, 49 metadata (1 START / 2 END / 3 COMPLETE).
- **Responses:** `parse_response`: cmd at [6], request seq at [7], result at [8], body from [9].
- **History:** `history_end_token(frame)` = `frame[17:25]`; `ack_history(token)` = cmd 23 with body `01` + token.
- **Type-47 decoder:**
  - v24: ts @11, HR @21, RR count @22, RR u16 @23 (skip zeros), gravity f32 @40/44/48, skin contact @55, skin temp raw @72, respiration raw @80
  - v25 (84 bytes): ts @11, gravity i16 @73/75/77 ÷ 16384, no HR
  - unknown version → flagged `undecoded`, raw frame kept
- **Type 40:** realtime HR/RR. **2A37:** RR in 1/1024 s → ms.
- **Blocklist:** `build_command` hard-refuses 15, 25, 29, 32, 33, 36–38, 45, 83, 99 and 142–144. Command 20 (abort) stays allowed.

**`whoop-bridge/`** (runs on the Mac host, not in Docker):
- **`bridge.py`** (bleak):
  - scan for service `61080001-…`, connect, subscribe to 0003/0004/0005 (+2A37) through one shared reassembler
  - once per connection: 26 (bonding write) → 7 → 10/11 (set clock, read back) → 63 `00` → 34 → wait ~1.5 s → 22 (history)
  - on every END: commit the chunk's frames to the local outbox, **then** send ACK 23
  - 60 s watchdog; on failure send 20 (abort, no trim)
  - cycle every 15 min, or immediately when TP signals "sync now"
- **Uploader thread:** outbox → `POST /api/whoop/bridge/frames` in batches (≤ 2000 frames, gzip, `batchId`). Frames are deleted from the outbox only after a 2xx. If TP is down, the bridge keeps buffering.
- **Heartbeat** every 60 s: strap connected, battery (cmd 26, falling back to event 3), firmware, hashed serial, outbox size, last sync. The response carries `syncRequested`.
- **Config:** `~/.trainingplenum-whoop/config.json` with `url` and `token`, written by `bridge.py setup <URL> <TOKEN>`. TP shows that command ready to copy.
- **`requirements.txt`** (bleak), **`install-mac.sh`** (venv + LaunchAgent `com.trainingplenum.whoop-bridge.plist`), **`README.md`** (Bluetooth permission, unpairing from the WHOOP app).

**`backend/whoop_sync.py`**: `register_whoop(app, db, User, user_id)`, following the `garmin_sync.py` pattern. Tables:
- `whoop_account`: `token_hash` (sha256; the token is shown only once), `bridge_last_seen`, `bridge_status` (JSON), `sync_requested`, `data_through`, `last_error`, `retention_days`
- `whoop_raw_batch`: PK `batch_id`, sha256, gzip blob, `received_at`. Used for idempotency and reprocessing; kept 30 days (`WHOOP_RAW_RETENTION_DAYS`)
- `whoop_hour`: PK (`user_id`, `hour_ts`), gzip JSON arrays `ts`/`hr`/`motion` (gravity delta norm in mg), `rr` [(ts, ord, ms)], `contact`, `skin_raw`, `resp_raw`. About 90 MB per year instead of 30M rows
- `whoop_day`: PK (`user_id`, `date`); sleep start/end, sleep minutes, efficiency, `rhr`, `hrv_rmssd`, baseline mean/spread, `readiness`, `band`, `confidence`, `strain`, `trimp`, `sleep_debt_min`, `computed_at`, version

Endpoints:
- **UI (behind the origin guard):**
  - `GET /api/whoop`: status
  - `POST /api/whoop/token`: create or rotate the token
  - `DELETE /api/whoop`: disconnect, optionally deleting the data
  - `POST /api/whoop/sync`
  - `GET /api/whoop/days?from=&to=`
  - `POST /api/whoop/recompute`
- **Bridge (bearer token, checked with `hmac.compare_digest`):**
  - `POST /api/whoop/bridge/heartbeat`
  - `POST /api/whoop/bridge/frames`: gzip, 8 MB decoded limit, idempotent on `batchId` + sha256 (same id with different bytes → 409). It decodes, merges into the `whoop_hour` chunks (dedupe on `ts` and `(ts, rr, seq)`) and marks the affected days dirty.
- **Worker thread** (like `start_garmin_worker`): recomputes dirty days and prunes expired raw batches.

**`backend/whoop_analytics.py`**: pure functions, tested with synthetic data.
- **Sleep detection:**
  - still = motion < 10 mg; a 15-min window counts as sleep when ≥ 70 % of it is still
  - split runs at gaps > 20 min, merge runs < 15 min into their neighbours
  - keep sleep ≥ 60 min with mean HR ≤ 1.05 × the day's median (1.30 when ≥ 90 % posture-stable)
  - each night belongs to the wake-up day in `TRAINHUB_TIMEZONE`
- **HRV:**
  - keep RR in 300–2000 ms, Malik filter (±20 % of the 5-beat median, in arrival order `ord`)
  - nightly HRV = mean RMSSD of 5-min windows, each needing ≥ 20 clean beats
- **RHR:** lowest 5-min mean during sleep (≥ 5 samples).
- **Baselines:** winsorized EWMA (half-life 14 nights for the baseline, 21 for the spread; ignore values > 5σ away, clamp to ±3σ). Limits: HRV 5–250 (spread floor 5), RHR 30–120 (spread floor 2).
- **Readiness:**
  - z-scores weighted HRV 0.55, RHR 0.20 (sign flipped), sleep duration vs need (8 h) 0.15; weights renormalised
  - readiness = `100/(1+exp(-1.6·(z̄+0.2)))`
  - bands: red < 34 ≤ yellow < 67 ≤ green
  - confidence: < 4 nights shows no number ("calibrating…"), 4–13 "provisional", 14+ "solid"
- **Strain:** Edwards TRIMP from %HRR (HRmax = `User.max_hr`, else Tanaka 208 − 0.7 × age; RHR from that night). Strain = 21 · ln(TRIMP+1)/ln(7201), on the 0–21 scale.
- **Sleep debt:** `debt = 0.55·max(0, need + debt − sleep)` over the last 14 nights.
- **Not in v1:** sleep stages, SpO₂, skin temperature in °C, respiration rate, illness flag (see phase 5).

## Changed files
- **`backend/app.py`:**
  - call `register_whoop(...)` next to the other registrations (~l.1033)
  - start the worker in `__main__`
  - add `recovery` to `/api/analytics` (days keyed with the same ISO keys as `fitness.days`)
- **`backend/wsgi.py`:** `start_whoop_worker(app)`.
- **`backend/coach_api.py:93,109`:** add `/api/whoop` to the guard and the no-store header. `/api/whoop/bridge/` skips the JSON and 64 KB checks and gets token auth plus its own limit instead; the host and origin checks still apply.
- **`backend/athlete_context.py` `build_snapshot`:**
  - new `wearable` parameter → `observed.wearable` section with `source:'device'`: today plus 14 days of readiness, HRV vs baseline, RHR, sleep, sleep debt and confidence
  - definitions in `dataQuality`
- **`backend/coach_api.py`:**
  - `snapshot()` (l.137) passes the WHOOP data through
  - week and patch proposals (l.771–814) get `recentRecovery`
  - system prompt (l.615–670): readiness red, or HRV below its baseline band together with negative TSB → reduce or swap intensity. The values are approximations, and missing data does not mean bad data.
- **`frontend/src/WhoopSync.jsx`** (new, same pattern as `GarminSync.jsx`, `.batch-dialog`):
  - step 1: unpair the strap from the WHOOP app
  - step 2: generate the token, copy the `install-mac.sh` and `setup` commands
  - status: bridge online/offline, strap connected, battery, data through, calibration progress (x/4, x/14 nights)
  - buttons: "Sync now", "Recompute", "Disconnect"
- **`frontend/src/UserMenu.jsx` / `App.jsx`:**
  - "WHOOP" menu entry and `showWhoop` state
  - status polling like Garmin (l.816–831), reloading the recovery days when `dataThrough` changes
  - load `whoopDays` and pass them to Today, the calendar and the Dashboard
- **`frontend/src/Home.jsx`:**
  - "Recovery today" tile at the top of `.home-side`: readiness ring, HRV (ms, ±% vs baseline), RHR, sleep, sleep debt, confidence
  - rule-based planning hint next to "Today": e.g. red + intervals planned → "Easy day or swap with …", linking to a coach patch
- **Calendar in `App.jsx` (l.995–1041 / 1045–1081):**
  - coloured readiness dot and value in `.calendar-day-header`
  - week column `.calendar-summary`: average readiness, average HRV vs baseline
- **`frontend/src/Dashboard.jsx`:** "Recovery" card next to `FitnessCard`: HRV with baseline band, RHR, 90-day readiness bars on the same time axis as CTL/ATL/TSB.
- **CSS:** tokens from `theme.css` (`--success`/`--warning`/`--danger`).
- **Docs:**
  - `MAC-DOCKER-GARMIN.md` → WHOOP section
  - `.env.example` (`WHOOP_RAW_RETENTION_DAYS`)
  - README API table and roadmap
  - `backup.py` README text: the WHOOP tables are included automatically in the SQLite backup

## Phases (each one shippable)
1. **Protocol + bridge + raw ingestion:** `whoop_protocol.py` with tests, the bridge, `whoop_sync.py` (token, heartbeat, frames, decoding) and a minimal WHOOP modal. **Milestone:** with the real strap, TP shows "data through today 07:10, HR ✓, RR ✓". From here, offsets can be checked against the real device.
2. **Analytics:** `whoop_analytics.py`, `whoop_day`, the worker, `/api/whoop/days`.
3. **Planning UI:** Today tile with planning hint, calendar badges, Dashboard card.
4. **Coach:** snapshot, week and patch context, prompt rules.
5. **Later (v2):** respiration rate, relative skin temperature, illness flag (2 of 4 signals), sleep stages, automatic workout detection, optionally WHOOP TRIMP as a cross-check on CTL. In v1 TRIMP stays out of CTL so it isn't double-counted with Garmin activities.

## Risks / deliberately open
- **macOS Bluetooth permission (TCC) under launchd:** the first run must be interactive in Terminal so macOS shows the Bluetooth prompt. If launchd still gets blocked, fall back to a login item. Checked in phase 1.
- **Firmware variance:**
  - cmd 26 may not reply → battery from event 3
  - SET_CLOCK may need the 8- or 9-byte form → read the clock back
  - unknown record version → raw frame kept, status shows "undecoded"
- **Strap buffer** reportedly ~14 days: if the bridge is down longer, data is lost. TP warns when the bridge has been offline for more than 24 h.
- **The values are approximations,** not WHOOP's scores and not a medical device. The UI says so.

## Verification
- **Backend unit tests** (`python -m unittest` in `backend/`):
  - `test_whoop_protocol.py`: CRC8 check values (`14 00`→`03`, `08 00`→`a8`), two verified event frames, generated command frames (e.g. cmd 26 → `aa 08 00 a8 23 00 1a 00 17 25 ee 23`), ACK body for token (7, 2), reassembler with fragmented and noisy bytes, a synthetic v24 record. Fixtures are in `RESEARCH-WHOOP4-PROTOCOL.md` §6.
  - `test_whoop_analytics.py`: a synthetic night → sleep window, RMSSD vs a hand calculation, RHR, baseline and confidence tiers, strain scale
  - `test_whoop_sync.py` (pattern of `test_garmin_sync.py`): token auth 401/403, idempotency and 409, the gzip limit, the guard exemption applying only to `/bridge/`, dedupe across batches, dirty-day recompute
- **Bridge without a strap:** a fake client replays recorded frames (END → outbox commit → ACK ordering, watchdog, abort).
- **Frontend:** `npm test` (WhoopSync; Home tile in calibrating, green and red states).
- **End to end on the Mac:**
  1. start the Docker stack, generate a token in TP, run `install-mac.sh` and `setup`
  2. keep the strap, unpaired from the WHOOP app, in range
  3. expect the WHOOP modal to show bridge online, strap connected, battery, and a rising "data through"
  4. after the first night: sleep/HRV/RHR in the calendar, readiness "calibrating 1/4"
  5. cross-check the history HR against realtime HR (2A37)
