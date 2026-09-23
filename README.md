# TrainHub — Training Data Platform

Eine Trainings-Datenplattform inspiriert von TrainingPeaks. Fokussiert auf Daten-Upload und interne Nutzung.


## FIT import — files and folders

The importer reads `.fit` and `.fit.gz` directly, individually or in a batch. It preserves originals, every record, actual UTC timestamps, laps and separate sport sessions. The page displays timer time separately from elapsed time, available sensors, and gaps without turning missing data into zeros. Reloads load saved activities; duplicate files open the existing activity. Multi-file and folder imports show progress, skip duplicates, and report errors per file. ZIP files must be extracted first.

TrainingPeaks exports can be extracted locally and imported as a complete folder. Personal recordings, SQLite databases, upload folders and local verification reports are excluded from version control. A fresh clone starts without athlete recordings; existing local data stays on your machine.

### Import a complete folder

1. Open the extracted export folder in Explorer, press **Ctrl+A**, and drag the files onto TrainHub. Alternatively, use **+ Upload → Ordner auswählen** to select the whole folder, or **Dateien auswählen** to select multiple files.
2. Check the file count, then click **Dateien importieren** once. Nested folders are included. Files are processed sequentially with separate imported, duplicate, skipped and error results.
3. Use **Aktivitäten anzeigen** when finished. A bad file does not stop the queue. You can stop after the current file, resume the remaining files, or retry failures. Already saved recordings remain saved; reselecting the same folder skips them.

Keep the tab open during the import. The current queue/results live in the tab; successfully imported activities and original files persist on the server. FIT, FIT.GZ, GPX and TCX are supported by the batch selector. Unsupported files are listed as skipped. CSV/manual entry remains under **Manuelle Eingabe / CSV**.

### Explore a route on OpenStreetMap

Open any activity with recorded GPS coordinates. Its details include an interactive OpenStreetMap route with start/finish markers, place and street labels, zoom, a regional overview and a larger map view. Hover over any activity chart to move the map marker to the corresponding recorded time and see its distance, speed, heart rate and power. The last point stays selected when the pointer leaves the chart. You can also click a section of the route or its start/finish controls. A sample without GPS hides the marker until a valid position is selected. Existing imports work immediately; no re-import is needed.

The basemap uses internet access. The track is drawn locally in the browser from the saved recording; no FIT files or complete tracks are submitted to a mapping service. Map tile requests go to OpenStreetMap for the displayed area, using normal browser caching and visible attribution. Tiles load only when the map first enters the viewport. Missing or invalid GPS fixes and long gaps are shown as separate segments; activities without GPS show an empty-state explanation.

`REACT_APP_MAP_TILE_URL` can select another compatible raster tile service before rebuilding. If switching providers, update the attribution to their requirements in `RouteMap.jsx`. See the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) and [Leaflet documentation](https://leafletjs.com/reference.html). This implementation does not bulk-download tiles or offer offline map downloads. Place names come from the basemap; it does not generate a separate itinerary or reverse-geocode the ride.

### Personal bests

On **Startseite**, the **Bestwerte** card sits below the heart-rate zones. Switch between **Radfahren** and **Laufen**, select an activity year or **All-Time**, and click a result's date to open its activity. The default is the current calendar year (or the calendar year you navigated to). New imports automatically refresh the results.

- Cycling: highest time-weighted average power over 30 seconds and 1, 3, 5, 10, 20 and 60 minutes. The calculation searches complete rolling windows inside a single recorded session, includes recorded zero power, and holds each reading up to the next timestamp. It does not use the activity's average power.
- Running: fastest elapsed time over exactly 400 m, 1 km, 5 km, 10 km and 21 km, using the recording's cumulative distance in metres. Distance crossings between samples are interpolated. Pauses inside an effort count toward its time. The 21 km target is exactly 21,000 m.
- Missing readings, backwards timestamps, distance resets and gaps longer than 30 seconds split the data; efforts never bridge those breaks or different sport sessions. Summary-only activities cannot supply a best effort. Insufficient data appears as a dash.
- Years refer to the activity's start date in the browser's time zone. All-Time covers all imported history. These are best recorded training efforts, not certified race records.

`GET /api/best-efforts?sport=ride&year=2026&timezone=Europe%2FBerlin` returns the targets, source activities and elapsed interval boundaries. Use `sport=run` or `year=all` as appropriate. A versioned SQLite cache stores per-activity calculations, so switching filters does not reprocess the full sensor streams. Sport changes invalidate the affected cache and deleting an activity removes its cached efforts.

### Athlete analytics dashboard

**Dashboard** now includes a time-share donut for every recorded sport, cycling distance/elevation for every available year, the existing cycling/running best efforts, training hours and calories by week, cycling power TSS by week/day, and stacked weekly heart-rate/power-zone charts. Select a calendar year or **All-Time** and a sport for the summary/weekly charts. All weekly charts show the complete selected year from January to December, with one bar per week and month labels; All-Time shows the complete history with year labels. Future weeks are shaded as pending. Totals cover the entire selected period. The sport mix always compares all sports; cycling annual totals always cover all available years. The daily TSS view has its own week selector and defaults to the current week for the current year. Every chart offers exact values and an expandable data table. The activity list remains below the analyses.

Use **FTP & Zonen** to save FTP and maximum heart rate on the athlete profile. Missing thresholds show a setup prompt. Thresholds apply to the entire selected history, without historical FTP changes. The five HR zones use 60/70/80/90% of maximum HR; the seven cycling power zones use 55/75/90/105/120/150% of FTP. Exact boundaries belong to the lower zone, and recorded zero power belongs to Z1. Running power is not classified against cycling FTP.

Analyses use actual sample intervals, excluding missing readings, backwards/overlapping timestamps, gaps over 30 seconds, and preceding sport-session measurements. No final sample duration is invented. Multisport files contribute separate sport sessions, without also counting their parent totals. Dates use the browser's timezone, weeks start Monday, and year-boundary weeks include only sessions in the selected year. The current week/year can be incomplete. Missing metrics display a dash; partial sums are identified. Calories use stored values, which may be source estimates.

Cycling TSS is an estimate: `hours × (normalized power / FTP)² × 100`. The power calculation uses complete 30-second rolling windows on time-weighted one-second readings, with independent windows across sensor gaps/session boundaries. Only rides whose measured power duration is within 5% of timer duration supply TSS; missing rides and non-cycling sessions remain unavailable rather than receiving a fabricated stress score. See the [TrainingPeaks calculation reference](https://help.trainingpeaks.com/hc/en-us/articles/204071804-Normalized-Power). Per-activity sensor histograms and power summaries are cached in SQLite; changing thresholds reclassifies the cache without rereading streams. Imports, sport changes and deletions are reflected on the next refresh.

`GET /api/analytics?year=2026&sport=all&timezone=Europe%2FBerlin` returns all summary, annual and weekly/day series. `PUT /api/user` accepts nullable numeric `ftp` (1–1000 W) and `maxHr` (60–250 bpm). Startup adds these profile columns and the analytics cache table without replacing activities. Check with `.venv/Scripts/python.exe -m unittest -v test_analytics test_fit_import test_best_efforts` from the backend directory and the frontend test/build commands below.

### Start on Windows

After the first setup, run from this folder:

```powershell
.\start-local.ps1
```

Then open http://localhost:3000. The launcher starts hidden local servers if the ports are free and writes logs/process IDs to `.run/`. To stop a launched server, use `Stop-Process -Id <ID>` with its recorded PID. If another program already uses a port, stop that program or choose a different port before starting TrainHub.

First setup (dependencies are installed in this workspace already):

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
cd frontend
npm install
npm run build
cd ..
.\start-local.ps1
```

Rebuild with `npm run build` in `frontend` after changing the UI. For development, `npm start` runs React with live reload instead of the static server.

### Run checks

```powershell
cd backend
.venv/Scripts/python.exe -m unittest -v test_fit_import
cd ../frontend
npm test -- --watchAll=false --runInBand
npm run build
```

Tests use a temporary database and do not modify personal activities. On startup, the backend adds one metadata column to older SQLite databases without replacing rows. For local use, `DATABASE_URL` and `UPLOAD_FOLDER` can override the default database/upload paths. Start the API with `python app.py` (this also initializes/migrates its schema).

## Features (MVP)

- **Startseite** — 3-Spalten-Layout wie TrainingPeaks: Trainingspläne, Heute/Morgen, Wochenübersicht
- **Datei-Upload** — .fit, .gpx, .tcx, .csv Dateien hochladen und parsen
- **Manuelle Eingabe** — Workouts manuell eintragen
- **Kalender** — Monatsübersicht mit täglichen Aktivitäten
- **Dashboard** — Sportarten-Anteile, Rad-Jahresvergleich, Bestwerte, Wochenumfang, Kalorien, TSS und Zonenzeiten mit interaktiven Charts
- **Aktivitäts-Detail** — Zusammenfassung + interaktive Zeitreihen-Charts (HF, Geschwindigkeit, Leistung, Höhe)
- **Duplikat-Erkennung** — Verhindert doppelte Uploads
- **Herzfrequenz-Zonen** — Visuelle Darstellung der HR-Zonen

## Tech Stack

| Komponente | Technologie |
|------------|-------------|
| Frontend | React 18 |
| Backend | Python Flask |
| Datenbank | SQLite |
| File Parsing | fitparse, gpxpy, lxml |
| Container | Docker + Docker Compose |
| Reverse Proxy | Nginx |

## Schnellstart

### Mit Docker (empfohlen)

```bash
# Repository klonen / in den Ordner wechseln
cd trainhub

# Container starten
docker-compose up --build

# Öffne im Browser:
# Frontend: http://localhost:3000
# API:      http://localhost:5000/api/health
# Nginx:    http://localhost:80
```

### Ohne Docker

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
# Läuft auf http://localhost:5000
```

**Frontend:**
```bash
cd frontend
npm install
npm start
# Läuft auf http://localhost:3000
```

## API Endpoints

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| GET | `/api/health` | Health Check |
| GET | `/api/user` | User-Profil |
| PUT | `/api/user` | Profil aktualisieren |
| GET | `/api/activities` | Alle Aktivitäten |
| GET | `/api/activities/:id` | Einzelne Aktivität (mit Zeitreihen) |
| POST | `/api/upload` | Datei hochladen (.fit/.gpx/.tcx/.csv) |
| POST | `/api/activities/manual` | Manuelle Aktivität erstellen |
| PUT | `/api/activities/:id` | Aktivität bearbeiten |
| DELETE | `/api/activities/:id` | Aktivität löschen |
| GET | `/api/stats/weekly` | Wöchentliche Statistiken |
| GET | `/api/analytics` | Sportarten-, Jahres-, Wochen-, Tages- und Zonenanalysen |

## Datei-Upload

Unterstützte Formate:
- **.fit** — Garmin FIT-Dateien (vollständiges Parsing mit fitparse)
- **.gpx** — GPS Exchange Format (Tracks + HR-Extensions)
- **.tcx** — Training Center XML (Garmin/Polar)
- **.csv** — Einfache CSV mit Spalten wie hr, speed, power, cadence

### Upload-Workflow
1. Aktivitätstyp wählen (Laufen/Radfahren/Schwimmen)
2. Datei hochladen oder manuell eingeben
3. System parst die Daten automatisch
4. Aktivität wird in der Datenbank gespeichert

## Projektstruktur

```
trainhub/
├── docker-compose.yml
├── README.md
├── nginx/
│   └── nginx.conf
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app.py              # Flask API + File Parser
│   ├── data/               # SQLite DB (auto-generiert)
│   └── uploads/            # Hochgeladene Dateien
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── public/
    │   └── index.html
    └── src/
        ├── index.js
        └── App.jsx           # Haupt-React-App
```

## Geplante Features (v2+)

- [ ] Fitness / Fatigue / Form (CTL/ATL/TSB) Algorithmus
- [ ] Coach-Accounts mit Athleten-Zugriff
- [ ] Erweiterte Analytik (Leistungskurve, Zonentabellen)
- [ ] Externe Integrationen (Garmin Connect, Strava, WHOOP)
- [x] Cycling power TSS estimate with configurable FTP (running/hrTSS remains future work)
- [ ] Trainingsplan-Builder
- [ ] PostgreSQL für Production
- [ ] User Authentication (JWT)
- [ ] GDPR-konformes Datenmanagement

## Lizenz

Private Nutzung — Internes Projekt
