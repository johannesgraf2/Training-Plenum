# Training Plēnum — Training Data Platform

**Deine Trainingsdaten, lokal gespeichert und nachvollziehbar ausgewertet.**
Training Plēnum ist eine selbst gehostete Trainingsplattform für Radfahren und Laufen. Importiere FIT-Dateien, analysiere Leistung, Puls und Pace, plane strukturierte Workouts (auf Wunsch KI-gestützt) und exportiere sie als FIT-Datei für deinen Garmin. Kein Abo, kein Cloud-Zwang, und die Daten gehören dir. Der optionale KI-Coach plant mit deinem eigenen OpenAI-Key ganze Trainingsblöcke passend zu Ziel und verfügbarer Zeit; übernommen wird nur, was du bestätigst, und deine Rohdaten verlassen nie den Rechner.

## Warum Training Plēnum?

| Vorteil | Was das konkret bedeutet |
|---------|--------------------------|
| 🔒 **Deine Daten bleiben bei dir** | Läuft auf deinem Rechner, per Windows-Launcher oder Docker. Datenbank und Originaldateien liegen auf deiner Festplatte. Tracks und FIT-Dateien gehen an keinen Kartendienst, die Route wird im Browser gezeichnet. |
| 🤖 **KI-Coach, aber du entscheidest** | Optional plant ein KI-Coach ganze Trainingsblöcke und Wochen nach Ziel, verfügbarer Zeit und deinen Check-ins, mit deinem eigenen OpenAI-Key. Übernommen wird nur, was du bestätigst. Fixierte Einheiten bleiben unangetastet, und Rohdaten verlassen nie den Rechner. |
| 📚 **Über 500 Workout-Vorlagen** | Mehr als 500 fertige Einheiten für Rad, Lauf und Schwimmen, von Grundlage, Sweetspot und Schwelle bis VO2max, Mikrointervalle und Tests, viele als Steigerung über Block-Start, -Mitte und -Ende. Nach Stichwort, Trainingsart und Blockphase durchsuchbar; Watt- und Pulsziele passen sich an deine FTP und maximale HF an. Selbst auswählen oder vom KI-Coach passende Einheiten planen lassen. |
| 📦 **Umzug von TrainingPeaks oder Garmin Connect in Minuten** | Den entpackten Export als ganzen Ordner per Drag & Drop importieren. FIT, FIT.GZ, GPX und TCX werden nacheinander verarbeitet, Duplikate übersprungen und fehlerhafte Dateien einzeln gemeldet, ohne dass der Import abbricht. |
| 📈 **Die Kennzahlen, die du kennst** | Bestwerte (Leistung 30 s bis 60 min, Laufzeiten 400 m bis 21 km), Normalized Power und TSS, Zeit in HF- und Leistungszonen, Wochenumfänge, Sportarten-Mix und Jahresvergleiche. Jedes Diagramm zeigt exakte Werte und eine aufklappbare Tabelle. |
| ⚡ **Schnell, auch mit Jahren an Daten** | Berechnungen werden pro Aktivität zwischengespeichert. Filter und Jahreswechsel reagieren sofort. Nach einer FTP-Änderung werden nur die Zonen neu berechnet, ohne alle Dateien erneut einzulesen. |
| 🧪 **Nachvollziehbar und getestet** | Alle Formeln sind offen und mit Quellen belegt. Automatische Tests prüfen Backend und Frontend, und jede exportierte FIT-Datei wird vor dem Download noch einmal eingelesen und geprüft. |

### Für wen?

- **Ambitionierte Radfahrer:innen und Läufer:innen**, die ihre Daten besitzen und genau verstehen wollen, wie Kennzahlen entstehen.
- **Umsteiger:innen von TrainingPeaks & Co.**, die ihre komplette Historie mitnehmen möchten.
- **Garmin-Nutzer:innen**, die strukturierte Workouts ohne Umweg über eine Cloud aufs Gerät bringen wollen.

> **Hinweis:** Training Plēnum ist aktuell eine lokale Anwendung für eine:n Athlet:in. Für den Betrieb auf einem entfernten oder geteilten Server fehlen noch Authentifizierung und Härtung (siehe [Geplante Features](#geplante-features-v2)).

**Schnell loslegen:** [Start unter Windows](#start-on-windows) · [Start mit Docker](#mit-docker-empfohlen) · [AI Coach einrichten](AI-COACH.md)

## So sieht es aus

> Alle Screenshots zeigen erfundene Demo-Daten („Demo Athlet“), keine echten Aufzeichnungen. Zum Vergrößern ein Bild anklicken.

**Startseite:** Datum, Wettkampfziel mit Countdown, das heutige Workout als Leistungsprofil, Wochenumfang, Bestwerte und die letzten Aktivitäten.

[![Startseite mit Wettkampfziel, heutigem Workout, Wochenumfang und Bestwerten](docs/screenshots/startseite.png)](docs/screenshots/startseite.png)

<table>
  <tr>
    <td width="50%"><a href="docs/screenshots/kalender.png"><img src="docs/screenshots/kalender.png" alt="Monatskalender mit absolvierten und geplanten Einheiten sowie Wochensummen"></a><br><b>Kalender:</b> absolvierte und geplante Einheiten (gestrichelt), rechts die Wochensummen je Sportart. Geplante Workouts lassen sich per Drag &amp; Drop verschieben.</td>
    <td width="50%"><a href="docs/screenshots/aktivitaet.png"><img src="docs/screenshots/aktivitaet.png" alt="Aktivitätsdetails mit Kennzahlen und Verlaufsdiagrammen für Herzfrequenz, Leistung, Geschwindigkeit und Kadenz"></a><br><b>Aktivität:</b> Kennzahlen, erkannte Sensoren und der komplette Verlauf von Puls, Leistung, Tempo, Kadenz und Höhe. Darüber liegt die interaktive Karte.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/dashboard.png"><img src="docs/screenshots/dashboard.png" alt="Dashboard mit Jahreskennzahlen, Sportarten-Mix, Jahresvergleich, Bestwerten und Trainingsumfang"></a><br><b>Dashboard:</b> Jahreszahlen, Sportarten-Mix, Jahresvergleich, Bestwerte und der Wochenumfang.</td>
    <td><a href="docs/screenshots/dashboard-wochen.png"><img src="docs/screenshots/dashboard-wochen.png" alt="Wöchentliche Diagramme für Kalorien, TSS, Herzfrequenz- und Leistungszonen"></a><br><b>Trainingswochen:</b> Kalorien, TSS sowie die Zeit in Herzfrequenz- und Leistungszonen pro Woche.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/workout-editor.png"><img src="docs/screenshots/workout-editor.png" alt="Workout-Editor mit Vorlagen und Leistungsprofil eines Intervall-Workouts"></a><br><b>Workout-Editor:</b> Vorlagen, Intervalle mit Watt-/Pace-/HF-Zielen und die Gesamtübersicht. Direkt als Garmin-FIT-Datei exportierbar.</td>
    <td><a href="docs/screenshots/workout-vorlagen.png"><img src="docs/screenshots/workout-vorlagen.png" alt="Vorlagen-Bibliothek mit 528 Beispiel-Einheiten, Filtern nach Trainingsart und Blockphase sowie VO2max-Progressionen"></a><br><b>Workout-Vorlagen:</b> über 500 Einheiten für Rad, Lauf und Schwimmen, filterbar nach Trainingsart und Blockphase. Progressionen zeigen Start, Mitte und Ende eines Trainingsblocks.</td>
  </tr>
  <tr>
    <td><a href="docs/screenshots/import.png"><img src="docs/screenshots/import.png" alt="Importdialog zum Ablegen von Dateien oder ganzen Ordnern"></a><br><b>Import:</b> einzelne Dateien oder einen ganzen Exportordner per Drag &amp; Drop übernehmen.</td>
    <td><a href="docs/screenshots/ai-coach.png"><img src="docs/screenshots/ai-coach.png" alt="AI Coach mit Trainingsstunden der letzten Wochen und drei Einrichtungsschritten"></a><br><b>AI Coach:</b> Überblick über die letzten Wochen und in drei Schritten zum ersten Trainingsblock (Athletenprofil, eigener API-Key, Block planen).</td>
  </tr>
</table>


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

### Start page background and race-goal photo

The start page shows a bundled landscape behind the date. In the user menu (your name, top right) under **Hintergrund**, choose **Landschaft**, **Foto** (upload your own JPEG, PNG or WebP up to 10 MB) or **Aus**. The race-goal card has its own photo: use the camera button on its image to add or replace it, the bin button to remove it. Photos are stored in the upload folder (`uploads/appearance`) on this machine and are never sent anywhere else; the page washes them towards the page colour so the text stays readable.

### Personal bests

On **Startseite**, the **Bestwerte** card sits below the race goal. Switch between **Radfahren** and **Laufen**, select an activity year or **All-Time**, and click a result's date to open its activity. The default is the current calendar year (or the calendar year you navigated to). New imports automatically refresh the results.

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

### AI Coach and athlete context

**AI Coach** combines a compact athlete snapshot with goals, default availability, weekly/daily overrides and subjective check-ins. Connect your own OpenAI API key, review a macro plan, then generate individual weeks or patches. TrainHub renders workout templates, enforces availability and locked sessions, and only applies recommendations after explicit confirmation. Imported sensor streams are never sent to the provider.

Install the updated backend requirements. On first start the backend creates the server-side key file `.run/ai-encryption-key.txt` that encrypts a saved provider key, unless `TRAINHUB_AI_ENCRYPTION_KEY` is set; back that file up separately from the database. See [AI Coach setup, data definitions, security and API](AI-COACH.md) for key backup/rotation, provenance, calendar boundaries, current limitations and the complete workflow. This remains a local single-athlete application; remote/shared deployments require authentication and deployment hardening.

### Plan a workout and export it to Garmin

On **Startseite**, click **Workout hinzufügen** under **Heute** or **Morgen** (or the corresponding **+**). The editor starts with that day's date. Choose running or cycling and add, remove or reorder steps and repeat blocks. Templates are filtered by the selected sport; selecting one replaces the draft's name and steps, preserving the date. All values are editable.

- Cycling templates: 30 minutes at 180 W; 60 minutes at 140 W; five repetitions of 4 minutes at 330 W and 4 minutes recovery at 120 W; and **3 × 7 × 40/20 s**, with 40 seconds at 330 W and 20 seconds at 120 W. Both interval templates include 10 minutes warmup at 120 W and 10 minutes cooldown at 100 W. The 40/20 workout has exactly two additional 5-minute rests at 120 W between its three sets (51 minutes total). Its three independent repeat blocks remain editable and export without nested repeats.
- Running templates: **10 × 400 m / 200 m jog**, **5 × 1 km / 400 m jog**, and **3 × 2 km / 600 m jog**. Each includes 2 km warmup and 1 km cooldown. Work intervals start with an editable example pace of 4:00–4:10/km; recovery has no target. These templates cover 9 km, 10 km and 10.8 km respectively.

The **Gesamtübersicht** expands all repetitions in an interactive profile and shows total duration/distance, work, recovery and average target power when available. All-time workouts use a proportional time axis; all-distance workouts use a proportional distance axis. Mixed/open workouts use equal-width steps explicitly labelled as a sequence. Watt-target bars use their target (the midpoint for a range); unspecified targets are never presented as zero watts. Click any repetition to jump to its shared editor. Average target power is time-weighted and only shown when every step has a known time and power target.

In **Kalender**, hover over a day to reveal **+** and plan a workout with that date already selected. The button also appears with keyboard focus and stays visible on touch devices. Saved plans appear as **Geplant** cards on their local calendar dates. Click a card to edit it; moving its date or deleting it updates the calendar immediately. To reschedule, drag a **Geplant** card onto another day of the displayed month: the target day is highlighted, the plan moves at once and its new date is saved. If saving fails, the plan returns to its original day with an error message. Plans fixed in the AI Coach cannot be dragged until they are unfixed. Dragging works with a mouse; on touch devices or for another month, change the date in the editor. Plans remain separate from completed activities and the completed weekly totals.

Selecting **Intervalle mit Pause** or **+ Intervalle mit Pause** creates a complete repeated block with independent work/recovery durations and targets. The two halves appear side by side. A **Fester Wert** power target stores the same lower/upper watt value; **Zielbereich** keeps separate bounds. Every repeat includes its final recovery step, as shown in the overview. Existing saved workouts can still be opened and edited, including standalone interval steps.

- Duration: time in `min:ss`, distance in metres, or an open step ended with the Lap button.
- Targets: none, pace in `min:ss/km`, speed in km/h, absolute heart rate in bpm, power in watts, or cadence in rpm. Enter the faster pace first. Intensities include warmup, active, interval, recovery and cooldown.
- Repeat blocks contain ordinary steps, with 2–99 repetitions; nested repeats are not supported. The editor permits up to 50 encoded steps including repeat markers. Device-specific limits may be lower.
- **Workout speichern** persists the plan in SQLite. Today/tomorrow plans appear in the corresponding cards; other dates appear under **Weitere geplante Workouts**. Open a saved plan to edit, download or delete it. Plans are stored separately from completed activities and do not affect training statistics.
- **Garmin FIT herunterladen** exports the current editor contents, including unsaved edits. Saving is a separate action. The selected date prefixes the actual Garmin workout name, e.g. `24.09.2026 · 30 min konstant`, and the downloaded filename, e.g. `2026-09-24_30_min_konstant.fit`. The editor previews the device name. The saved plan keeps its original name; the FIT file contains the workout instructions and a dated name, not a device calendar entry.

Connect a compatible Garmin by USB, copy the downloaded `.fit` into `GARMIN/NewFiles`, then safely eject it and select the workout with the matching date in its training menu. Available USB access, targets and workout support depend on the device. The user confirmed the five-minute USB test workout appears in the Edge 1050 workout library; the separate schedule-file experiment did not produce a confirmed calendar entry. Date prefixes are checked in the exported FIT bytes. See [Garmin's transfer guidance](https://support.garmin.com/en-GB/?faq=AXV7LuWgc73v21nq6nbDa6).

The internal model is versioned JSON with `name`, `sport` (`run`/`ride`), a local `date` (`YYYY-MM-DD`) and `steps`. Ordinary steps have `kind: "step"`, `name`, `intensity`, `duration` and `target`; repeats have `kind: "repeat"`, `count` and ordinary `steps`. Model units are seconds, metres, seconds/km, km/h, bpm, watts and rpm. `POST /api/workouts` saves a plan, `GET /api/workouts` lists it, `PUT`/`DELETE /api/workouts/:id` edit/remove it, and `POST /api/workouts/export` downloads a validated FIT file from a model.

The official [Garmin Python FIT SDK](https://github.com/garmin/fit-python-sdk#encoder) handles encoding and CRC. `workout_export.py` implements the [Garmin workout mapping](https://developer.garmin.com/fit/articles/file-types/workout.html), including pace-to-speed conversion, absolute HR/power offsets and indexed repeat messages. Every exported file is decoded again and checked for integrity, step count, indices, repeat references and exact target values before download. Tests also use the existing independent `fitparse` decoder. Install the updated backend requirements before starting an existing checkout. Run `.venv/Scripts/python.exe -m unittest -v test_workout_export test_fit_import test_best_efforts test_analytics` from the backend directory, and the frontend test/build commands below.

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
- **AI Coach** — Athlete Snapshot, Athletenprofil, BYOK-Provider, Makro-/Wochenpläne und bestätigte Patches mit fixierten Einheiten; [Einrichtung und API](AI-COACH.md)
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

Absolvierte Aktivitäten lassen sich in ihrer Detailansicht über **Aktivität löschen** entfernen. Die Bestätigung zeigt Name und Datum; erst **Endgültig löschen** führt die Löschung aus. Kalender, Aktivitätslisten und Auswertungen aktualisieren sich anschließend. Bei einem Fehler bleibt die Aktivität geöffnet und die Löschung kann erneut versucht werden.

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
├── docs/
│   └── screenshots/        # Bilder für diese README (Demo-Daten)
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
