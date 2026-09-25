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

**Schnell loslegen:** [Start unter Windows](#start-unter-windows) · [Start mit Docker](#mit-docker-empfohlen) · [AI Coach einrichten](AI-COACH.md)

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


## Aktivitäten importieren

Training Plēnum liest **FIT**, **FIT.GZ**, **GPX** und **TCX**, einzeln oder als ganzen Ordner. Die Originaldatei bleibt erhalten, jeder Messpunkt wird gespeichert.

**Woher kommen die Dateien?**

- **Direkt vom Garmin:** Garmin per USB an den PC anschließen und den Ordner `GARMIN/Activity` auf den PC kopieren. Darin liegen deine Aktivitäten als FIT-Dateien. Auf dem Gerät sind meist nur die letzten Aktivitäten gespeichert.
- **Garmin Connect (komplette Historie):** Im Garmin-Konto unter **Datenverwaltung** den Datenexport anfordern. Der Download-Link kommt per E-Mail. Die ZIP-Datei entpacken und darin auch die weiteren ZIPs mit den Aktivitäten.
- **TrainingPeaks:** Export herunterladen und entpacken.

**So geht's:**

1. Oben rechts auf **Datei importieren / exportieren** klicken.
2. Dateien oder einen ganzen Ordner in das Fenster ziehen. Alternativ **Ordner auswählen** oder **Dateien auswählen**. Unterordner werden mitgelesen.
3. Auf **Dateien importieren** klicken und warten. Danach mit **Aktivitäten anzeigen** fertig.

**Gut zu wissen:**

- **ZIP-Dateien zuerst entpacken.** Direkt lesen kann Training Plēnum nur die entpackten Dateien.
- **Doppelte Dateien** werden erkannt und übersprungen. Denselben Ordner nochmal zu importieren schadet also nicht.
- **Eine kaputte Datei** stoppt den Import nicht. Sie wird in der Liste als Fehler angezeigt und lässt sich mit **Fehler erneut versuchen** nochmal probieren.
- **Anhalten:** **Nach aktueller Datei stoppen** beendet den Import sauber. Bereits importierte Aktivitäten bleiben gespeichert.
- **Tab offen lassen**, solange der Import läuft.
- **Strava-Export** (`activities.csv`) und **manuelle Einträge** gibt es unter **Manuelle Eingabe / CSV**.

Eine Aktivität löschen: Aktivität öffnen, **Aktivität löschen** und dann **Endgültig löschen** klicken.

## Aktivität ansehen

Ein Klick auf eine Aktivität zeigt Kennzahlen, erkannte Sensoren und den Verlauf von Puls, Leistung, Tempo, Kadenz und Höhe.

**Karte:** Hat die Aktivität GPS, erscheint die Route auf einer OpenStreetMap-Karte. Fährst du mit der Maus über ein Diagramm, springt der Punkt auf der Karte an dieselbe Stelle und zeigt Distanz, Tempo, Puls und Watt.

Die Route wird in deinem Browser gezeichnet. An OpenStreetMap gehen nur die Anfragen für die Kartenbilder des sichtbaren Ausschnitts, nie deine Tracks oder FIT-Dateien. Für die Karte braucht es daher Internet. Einen anderen Kartendienst kannst du über `REACT_APP_MAP_TILE_URL` einstellen (dann die Quellenangabe in `RouteMap.jsx` anpassen).

## Bestwerte

Auf der **Startseite** zeigt die Karte **Bestwerte** deine besten Leistungen, wahlweise für **Radfahren** oder **Laufen** und für ein Jahr oder **All-Time**. Ein Klick aufs Datum öffnet die passende Aktivität.

- **Rad:** höchste Durchschnittsleistung über 30 s sowie 1, 3, 5, 10, 20 und 60 min.
- **Laufen:** schnellste Zeit über 400 m, 1 km, 5 km, 10 km und 21 km.

Es zählen nur echte, zusammenhängende Aufzeichnungen. Lücken über 30 Sekunden, fehlende Werte oder ein Sportwechsel unterbrechen die Suche. Reichen die Daten nicht, steht ein Strich da. Es sind Trainingsbestwerte, keine offiziellen Wettkampfzeiten.

## Dashboard

Das **Dashboard** zeigt für ein Jahr oder **All-Time**:

- Anteil der Sportarten an deiner Trainingszeit
- Rad-Kilometer und Höhenmeter im Jahresvergleich
- Trainingsstunden und Kalorien pro Woche
- TSS pro Woche und pro Tag
- Zeit in Puls- und Leistungszonen pro Woche

Jedes Diagramm zeigt die genauen Werte und hat eine aufklappbare Tabelle. Darunter steht die Liste aller Aktivitäten.

**FTP und maximale Herzfrequenz** trägst du unter **FTP & Zonen** ein. Ohne diese Werte können Zonen und TSS nicht berechnet werden.

## Workouts planen und auf den Garmin bringen

**Workout erstellen:**

1. Auf der **Startseite** bei **Heute** oder **Morgen** auf **Workout hinzufügen** klicken, oder im **Kalender** bei einem Tag auf **+**.
2. Sportart wählen und Schritte bauen: Aufwärmen, Intervalle mit Pause, Erholung, Abwärmen. Ziele gehen nach Watt, Pace, Tempo, Puls oder Kadenz.
3. Oder eine fertige Einheit aus der **Vorlagen-Bibliothek** übernehmen (über 500 Vorlagen). Alle Werte bleiben änderbar.
4. **Workout speichern**. Es erscheint dann im Kalender.

Die **Gesamtübersicht** unten im Editor zeigt das ganze Workout als Leistungsprofil mit Dauer, Belastung und Erholung. Ein Klick auf einen Block springt direkt zu seinen Einstellungen.

**Im Kalender verschieben:** Geplante Workouts einfach per Drag & Drop auf einen anderen Tag ziehen.

**Auf den Garmin bringen:**

1. Im Editor auf **Garmin FIT herunterladen** klicken. Mehrere Workouts auf einmal: unter **Datei importieren / exportieren** auswählen (z. B. **Nächste 7 Tage**) und als ZIP herunterladen.
2. Garmin per USB anschließen und die `.fit`-Datei(en) in den Ordner `GARMIN/NewFiles` kopieren (ZIP vorher entpacken).
3. Garmin sicher auswerfen. Das Workout findest du im Trainingsmenü des Geräts. Das Datum steht im Namen, z. B. `24.09.2026 · 30 min konstant`.

Getestet auf dem Edge 1050. Welche Ziele und Funktionen unterstützt werden, hängt vom Gerät ab. Es entsteht kein Eintrag im Garmin-Kalender, nur ein Workout auf dem Gerät. Mehr dazu in [Garmins Anleitung](https://support.garmin.com/en-GB/?faq=AXV7LuWgc73v21nq6nbDa6).

## KI-Coach

Der KI-Coach plant auf Wunsch ganze Trainingsblöcke und Wochen nach deinem Ziel, deiner verfügbaren Zeit und deinen Check-ins. Du brauchst dafür einen eigenen OpenAI-API-Key.

- Nichts wird übernommen, bevor du es bestätigst.
- Fixierte Einheiten bleiben unangetastet.
- Deine Rohdaten (Sensorverläufe, FIT-Dateien) verlassen nie den Rechner. An OpenAI geht nur eine kompakte Zusammenfassung.

Der API-Key wird verschlüsselt gespeichert. Den Schlüssel dafür legt das Programm beim ersten Start in `.run/ai-encryption-key.txt` an. **Diese Datei getrennt von der Datenbank sichern**, sonst ist der gespeicherte API-Key nach einer Wiederherstellung nicht mehr lesbar.

Alle Details zur Einrichtung: [AI-COACH.md](AI-COACH.md)

## Startseite anpassen

Im Menü oben rechts (dein Name) unter **Hintergrund** wählst du **Landschaft**, ein eigenes **Foto** (JPEG, PNG oder WebP bis 10 MB) oder **Aus**. Die Wettkampfziel-Karte hat ein eigenes Foto: Kamera-Symbol zum Hinzufügen, Mülleimer zum Entfernen. Fotos bleiben auf deinem Rechner.

## Installation

### Start unter Windows

**Einmalig einrichten** (im Projektordner):

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
cd frontend
npm install
npm run build
cd ..
```

**Starten:**

```powershell
.\start-local.ps1
```

Dann im Browser http://localhost:3000 öffnen. Die Server laufen unsichtbar im Hintergrund; Logs und Prozess-IDs liegen in `.run/`. Beenden mit `Stop-Process -Id <ID>`. Ist ein Port schon belegt, zuerst das andere Programm beenden.

Nach Änderungen an der Oberfläche in `frontend` erneut `npm run build` ausführen.

### Mit Docker (empfohlen)

```bash
docker-compose up --build
```

Danach im Browser öffnen:

- App: http://localhost:3000
- API: http://localhost:5000/api/health

### Ohne Docker (Linux/macOS)

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py            # läuft auf http://localhost:5000

# Frontend (zweites Terminal)
cd frontend
npm install
npm start                # läuft auf http://localhost:3000
```

## Wie wird gerechnet?

Alle Formeln sind offen im Code nachlesbar. Die wichtigsten:

- **Normalized Power (NP):** berechnet aus dem gleitenden 30-Sekunden-Durchschnitt der Leistung, nach der [Methode von TrainingPeaks](https://help.trainingpeaks.com/hc/en-us/articles/204071804-Normalized-Power).
- **TSS (Rad):** `Stunden × (NP / FTP)² × 100`. Nur für Radfahrten, bei denen fast die ganze Zeit Leistung aufgezeichnet wurde. Sonst bleibt der Wert leer statt geschätzt.
- **Pulszonen (5):** Grenzen bei 60, 70, 80 und 90 % der maximalen Herzfrequenz.
- **Leistungszonen (7):** Grenzen bei 55, 75, 90, 105, 120 und 150 % der FTP.
- **Lücken:** Fehlende Werte werden nie als Null gezählt. Lücken über 30 Sekunden und Sportwechsel trennen die Daten.
- **Wochen** beginnen am Montag, Datumsangaben richten sich nach der Zeitzone deines Browsers.

Berechnungen werden pro Aktivität zwischengespeichert. Deshalb sind Filter schnell, und nach einer FTP-Änderung werden nur die Zonen neu eingeteilt.

## Für Entwickler

**Tests ausführen:**

```powershell
cd backend
.venv/Scripts/python.exe -m unittest -v
cd ../frontend
npm test -- --watchAll=false --runInBand
npm run build
```

Die Tests nutzen eine temporäre Datenbank und verändern keine eigenen Aktivitäten.

**Speicherorte:** Datenbank und Uploads liegen standardmäßig in `backend/data` und `backend/uploads`. Mit `DATABASE_URL` und `UPLOAD_FOLDER` lassen sie sich ändern. Beim Start ergänzt das Backend fehlende Tabellen und Spalten, ohne vorhandene Daten zu ersetzen. Persönliche Aufzeichnungen und Datenbanken sind von Git ausgeschlossen.

**Technik:** React 18 (Frontend), Python Flask (Backend), SQLite (Datenbank), fitparse, gpxpy und lxml (Dateien lesen), Garmin FIT SDK (Workout-Export), Docker Compose und Nginx.

**Workout-Export:** `backend/workout_export.py` erzeugt die FIT-Datei mit dem offiziellen [Garmin FIT SDK](https://github.com/garmin/fit-python-sdk). Jede Datei wird vor dem Download erneut eingelesen und auf Schritte, Wiederholungen und Zielwerte geprüft.

**Wichtige API-Endpunkte:**

| Methode | Endpunkt | Zweck |
|---------|----------|-------|
| GET | `/api/health` | Läuft der Server? |
| GET / PUT | `/api/user` | Profil, FTP und max. Herzfrequenz |
| GET | `/api/activities` | Alle Aktivitäten |
| GET / PUT / DELETE | `/api/activities/:id` | Eine Aktivität ansehen, ändern, löschen |
| POST | `/api/upload` | Datei hochladen |
| POST | `/api/activities/manual` | Aktivität von Hand anlegen |
| GET | `/api/analytics` | Daten für das Dashboard |
| GET | `/api/best-efforts` | Bestwerte |
| GET / POST | `/api/workouts` | Geplante Workouts |
| PUT / DELETE | `/api/workouts/:id` | Workout ändern oder löschen |
| POST | `/api/workouts/export` | Workout als Garmin-FIT-Datei |

Die Endpunkte des KI-Coachs stehen in [AI-COACH.md](AI-COACH.md).

## Geplante Features (v2+)

- [ ] Fitness / Ermüdung / Form (CTL/ATL/TSB)
- [ ] Coach-Accounts mit Zugriff auf Athleten
- [ ] Erweiterte Analysen (Leistungskurve, Zonentabellen)
- [ ] Anbindungen an Garmin Connect, Strava und WHOOP
- [x] TSS fürs Radfahren mit einstellbarer FTP (TSS fürs Laufen folgt)
- [ ] Trainingsplan-Builder
- [ ] Benutzeranmeldung (JWT)
- [ ] PostgreSQL für den Produktivbetrieb
- [ ] DSGVO-konforme Datenverwaltung

## Lizenz

Private Nutzung — Internes Projekt
