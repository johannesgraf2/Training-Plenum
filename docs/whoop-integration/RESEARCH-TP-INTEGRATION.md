# Integration points in Training Plenum

Read from the code on 2026-10-14. If files have changed in the meantime, check the line numbers again before editing.

## Stack and operation
- **Backend:**
  - Python 3.12+, Flask 3, Flask-SQLAlchemy, SQLite (`data/trainhub.db`), Gunicorn with **1 worker / 8 threads** (`backend/Dockerfile:18`).
  - Background threads run in-process, so everything must stay a single process.
- **Frontend:**
  - React 18 (CRA) in `frontend/src`, flat `.jsx` files.
  - **No router**: pages are switched via the `page` state in `App.jsx:720`.
- **Auth:** none. Every request uses a single fixed user, `DEMO_USER_ID='demo-user-001'` (`app.py:435-448`).
- **Schema changes:** there is no Alembic.
  - `initialize_database()` (`app.py:153-170`) calls `db.create_all()`. This also creates the tables from the `register_*` closures, because registration happens at import (`app.py:1033-1041`).
  - New columns are added with `inspect(...).get_columns()` plus `ALTER TABLE ... ADD COLUMN` inside `db.engine.begin()`.
- **Tests:** `python -m unittest` in `backend/`, `npm test` in `frontend/`.

## Docker on the Mac and the network path for the bridge
- **Containers:** `docker-compose.yml` runs two.
  - Only `web` (nginx) publishes a port: `${TRAINHUB_BIND:-127.0.0.1}:${TRAINHUB_PORT:-80}:80` (`:33`).
  - The backend's port 5000 is **not** published.
  - So the bridge on the Mac host reaches the API through nginx at `http://localhost[:PORT]/api/...`.
- **Backend environment:**
  - `TRAINHUB_COACH_ORIGINS` = `http://localhost:PORT,http://127.0.0.1:PORT` plus `TRAINHUB_EXTRA_ORIGINS` (`:17`)
  - `./data` is mounted at `/app/data` (`:20`)
  - the key file is at `/app/data/ai-encryption-key.txt` (`:13`)
- **nginx** (`nginx/nginx.conf`):
  - `client_max_body_size 50M` (`:15`)
  - `/api/` is proxied to `backend:5000` with `Host $host`, which drops the port (`:19`)
  - proxy timeouts are 600 s (`:24-25`)
- **Flask:** `MAX_CONTENT_LENGTH` 50 MB (`app.py:30`), `CORS(app)` open to every origin (`app.py:23`).
- **Process start:** `backend/wsgi.py:6-10` calls `initialize_database()` and then `start_garmin_worker(app)`. **`start_whoop_worker(app)` goes here as well**, and also in `app.py` `__main__`.
- **Running without Docker:** `start-local.ps1` (Windows) runs `python app.py` on :5000 and the frontend on :3000. There is no Mac start script.
- **Mac docs:** `MAC-DOCKER-GARMIN.md` (env table at `:34-41`) and `.env.example`.

## Origin guard (`backend/coach_api.py:90-111`)
```python
sensitive = request.path.startswith(('/api/coach/', '/api/ai-provider', '/api/athlete-', '/api/garmin', '/api/backup')) or request.path.endswith('/lock')
```
- **Host check:** the hostname of `request.host` must be one of the hostnames of the allowed origins (localhost, 127.0.0.1, `TRAINHUB_COACH_ORIGINS`).
- **`Origin` header:** checked **only if present**. A missing `Origin` passes, which is the case for the bridge.
- **Body checks:** POST/PUT/PATCH must be JSON (otherwise 415), and the body must be ≤ 64 KB (otherwise 413).
- **No-store header:** set in `after_request` at `:109` for the same prefixes.
- **WHOOP plan:**
  - Add `/api/whoop` at `:93` and `:109`.
  - **Exempt** `/api/whoop/bridge/` from the JSON and 64 KB checks: the bridge sends gzip, has its own limit and authenticates with a bearer token. The host and origin checks still apply.
  - If the bridge uses a different host name (e.g. `mac.local`), that name must be in `TRAINHUB_EXTRA_ORIGINS`.

## Template: Garmin (`backend/garmin_sync.py`)
- **Registration:** `register_garmin(app, db, PlannedWorkout, user_id, import_file)` defines the models and routes inside a closure.
  - State lives in `app.extensions['garmin']` (`SyncState`).
  - Models are in `app.extensions['garmin_models']`.
- **Encryption:** Fernet via env `KEY_ENV` from `ai_provider.py` (`ensure_server_key()` at `ai_provider.py:20-95`). WHOOP only needs a token **hash**, not encryption.
- **Worker:** the `_worker` / `start_garmin_worker` pattern (`:580-595`).
  - `trigger()` wakes the worker, or starts a one-off thread when there is none (tests).
  - `run_sync` holds a lock and calls `db.session.remove()` in `finally`.
- **Errors:** `jsonify(error=...)` with German messages; HTTP codes 400/401/409/502/503.
- **Status route:** `GET /api/garmin` returns status JSON with `lastSyncAt`, `lastError`, `running`, `recent`, …

## Data model (`backend/app.py`)
- **`User`** (`:42-60`): id, email, name, age, weight, sport, ftp, max_hr. There is no RHR or HRV field.
- **`Activity`** (`:63-106`), **`PlannedWorkout`** (`:109`), `WorkoutTemplate`, `TrainingBlock`, `BestEffortCache`.
- **`AnalyticsCache`** (`:145-150`) is per activity. WHOOP data is per day, so it gets its own `whoop_day` table.
- **No health or recovery tables exist yet.**

## Analytics (`backend/analytics.py`)
- **`fitness(rows, zone, ftp, max_hr)`** (`:235-265`) returns:
  `{value, fatigue, form, days:[{key, value, fatigue, form, load}], window:42, fatigueWindow:7, thresholdHr, activities:{...}}`
  over 730 days.
- **`/api/analytics`** (`app.py:970-988`) returns `aggregate(...)` plus `result['fitness']`. Add `result['recovery']` with the same `days[].key` (ISO date).

## AI coach
- **`athlete_context.build_snapshot(rows, efforts, athlete, self_reported, zone)`** (`:344-399`) returns:
  `{schemaVersion, asOf, timezone, athlete, observed, selfReported, dataQuality}`.
  - **`observed`** (`:365-369`): `currentTraining`, `trainingLoad`, `performanceHistory`, `trainingHistory`, `observedTrainingCapacity`.
  - **Change:** add a new `wearable=None` parameter and an `observed.wearable` section with `source:'device'`, plus definitions in `dataQuality.definitions` (`:388`). Data comes from `snapshot()` in `coach_api.py:137-140`.
- **Check-ins:**
  - `CHECK_IN_SCHEMA` (`coach_domain.py:180`) holds fatigue, motivation, stress, sleepQuality and soreness (1–5).
  - They are stored in `profile.checkIns` (`coach_api.py:218-224`).
  - Proposals inject the last 7 check-ins (`:733, :768, :803`).
- **Plan proposals:** POST `/api/coach/proposals` with kinds season, block, week and patch (`:693`), confirmed via `/proposals/<id>/confirm` (`:899`).
  - **Week and patch tasks do not get the snapshot** (`:771-814`), so `recentRecovery` must be passed there separately.
- **System prompt** (`:615-670`):
  - It already says to use form (TSB) for recovery decisions and not to infer readiness from absent data (`:628`). WHOOP rules go here.
  - Proposals are invalidated by a fingerprint check (`:174-183`). Decide whether WHOOP data should be part of it; it is probably not needed.

## Frontend: where WHOOP fits for planning
- **Garmin modal as the template:** `frontend/src/GarminSync.jsx`.
  - `garminRequest(apiBase, path, options)` (`:9-14`).
  - Loads status on mount (`:65-69`) and polls every 2 s while `running` (`:71-75`); `run()` busy wrapper (`:77-80`).
  - Shell: `.batch-backdrop` + `section.batch-dialog`, closed with Escape or a backdrop click (`:183-203`).
- **`UserMenu.jsx`:** `onOpenGarmin` prop, `.user-menu-link` button (`:48`, `:120`).
- **`App.jsx`:**
  - `showGarmin` state (`:723`), passed in at `:944`, rendered at `:1131-1132`.
  - Background polling every 5 min and on window focus (`:816-831`).
  - `plannedWorkouts` comes from `/api/workouts` (`:808-813`).
  - Nav items home, calendar, dashboard and coach (`:931`).
- **Calendar** (inline in `App.jsx:961-1084`, styles in `Calendar.css`):
  - Weeks are built by `calWeeks` (`:864-912`), Monday start.
  - Day cell (`:995-1041`) → readiness dot in `.calendar-day-header`.
  - Weekly sidebar `.calendar-summary` (`:1045-1081`) → average readiness and HRV.
- **Home** (`Home.jsx`):
  - Hero (`:206-217`), "Heute" card (`:221-246`), side column `.home-side` (`:267-300`) with `WeekChart` (`:114`).
  - `week[]` has per-day keys (`:154-165`).
  - → "Recovery today" tile at the top of `.home-side` and a planning hint next to "Heute".
- **Dashboard** (`Dashboard.jsx`):
  - Fetches `/api/analytics` (`:251`).
  - `FitnessCard` (`:207-230`) with `LOAD_SERIES` (`:124`) and `formStatus` (`:127`).
  - → "Recovery" card beside it.
- **Coach UI** (`AICoach.jsx`): plan tab at `:1222+`, check-in form with `CHECK_IN_LABELS` (`:334`).
- **`TrainingPlanner.jsx` is not imported anywhere** and looks orphaned.
- **CSS:**
  - Variables in `theme.css`: `--paper`, `--surface`, `--card`, `--card-line`, `--card-shadow`, `--accent`, `--success`/`--warning`/`--danger` (+ `-bg`), `--sport-*`, `--font-display`/`--font-body`.
  - Cards: `.home-card .home-block` with `.home-block-head`, `<Card>` in Dashboard, `.coach-card`.

## Backup and tests
- **Backup:** `backup.py:47-76` copies the whole SQLite file (`sqlite3.backup`) with no table list, so the WHOOP tables are included automatically. Only the README text (`:25`) needs a WHOOP mention.
- **Test pattern** (`test_garmin_sync.py:186-219`):
  - `setUpClass`: temp dir, env patch (`DATABASE_URL`, `UPLOAD_FOLDER`, `TRAINHUB_AI_ENCRYPTION_KEY` = a fresh Fernet key).
  - Load `app.py` with `importlib.util.spec_from_file_location(...)`, set `TESTING`, call `initialize_database()`, create `test_client()`.
  - `client.get('/api/user')` creates the demo user.
  - Replace `app.extensions[...]` state, e.g. a factory, with a fake.
