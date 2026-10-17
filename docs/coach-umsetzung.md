# AI Coach: Umsetzungsplan Stufe 1 (Rad)

Stand: 17.10.2026 · Grundlage: [`coach-ux.md`](coach-ux.md)

## Umfang

**In Stufe 1:**
- Onboarding Teil A und B
- Events mit A/B/C
- Verfügbarkeiten als Zeitfenster
- Plan mit Phasen und 3 ausgearbeiteten Wochen
- rollierendes Nachplanen
- Coach-Chat
- neue Bereiche Heute, Plan und Einstellungen

Sportart im Fokus ist **Rad**. Lauf und Kraft laufen mit den vorhandenen Vorlagen mit. Laufen bekommt dabei schon in Stufe 1 **Pace-Ziele** (siehe M1).


**Nicht in Stufe 1:**
- Swim, XC Ski, Hyrox, Triathlon und Duathlon
- Koppeleinheiten
- Garmin-Export für Swim und Strength

Die Datenmodelle lassen für diese Sportarten aber schon Platz (Sportart-Listen und Optionen pro Sportart), damit Stufe 2 nichts umbauen muss.

## Was bleibt und wiederverwendet wird

| Baustein | Datei | Rolle künftig |
| --- | --- | --- |
| Blockregeln, Rhythmus, Steigerungsketten | `coach_blocks.py` | Regeln der **Phasen**. Phasen werden intern als Blöcke gespeichert. |
| Saisonrahmen, `typicalSeason`, Reihenfolge | `coach_season.py` | Grundgerüst für die Phasenfolge bis zum A-Event |
| Templates, Rendering, TSS, Verpflegung | `coach_templates.py` | unverändert, Ultra-Ergänzung siehe M1 |
| Wochen- und Patch-Prüfung, Fixieren | `coach_domain.py`, `coach_api.py` | Prüfung für Planerstellung, Nachplanen und Chat-Änderungen |
| Vorschläge mit Fingerabdruck und Bestätigung | `coach_proposal` | Änderungskarten im Chat |
| Check-in, Ampel, Beschwerden | `coach_wellness.py`, `CoachToday.jsx` | unverändert |
| Provider, Verschlüsselung, strukturierte Antworten | `ai_provider.py` | unverändert, dazu ein Chat-Aufruf |
| Snapshot | `athlete_context.py` | Vorbefüllung in A1, A3, B1 und Kontext für alle KI-Aufrufe |

Das alte Coach-UI bleibt nutzbar, bis M4 fertig ist. Danach wird es ersetzt (M5).

## Meilensteine

Jeder Meilenstein ist für sich lauffähig, hat Tests und wird einzeln gemerged.

### M1 Datenmodell und API (Backend)

**Stand: umgesetzt.** Offen für M2: Test-Templates (FTP-Test, 30-min-Lauftest) und das Einplanen des Gruppentrainings als feste Einheit.

**1. Profil erweitern** (`coach_domain.py`, `PROFILE_SCHEMA`, `complete_profile`)
- `sports`: regelmäßige Sportarten (A1). Liste offen für Stufe 2: `ride`, `run`, `strength`, später `swim`, `xcski`, `hyrox` …
- `metrics`: Primärmetrik je Sportart, z. B. `{"ride": "power", "run": "pace"}`
- `thresholds`: Schwellenwerte je Sportart mit Herkunft (`athlete`, `calculated`) oder `"test"` für „Testen lassen“. FTP und max. HF bleiben in den bestehenden Einstellungen. Hier steht nur, ob ein Test gewünscht ist und woher der Wert kommt.

**2. Events** (neu, im Profil als `events[]`)
- Felder:
  - `id`, `title`, `sport`, `subtype`
  - `startDate`, `endDate`, `allDay`, `time`, `location`
  - `priority` (`A`|`B`|`C`) und `handling`: B `miniTaper`|`trainThrough`, C `replaceHard`|`easy`
  - `distanceKm` (0–10.000), `targetSeconds` (bis 60 Tage), `elevationM` (0–100.000)
  - `description` (geht als `athleteWish` an die KI)
- Ohne Event gibt es ein `goal` mit `vo2max`, `threshold` oder `fitness`.
- Migration: Ein gespeichertes `goal.date` mit Namen wird zum A-Event.
- API: `GET/POST /api/coach/events`, `PUT/DELETE /api/coach/events/<id>`

**3. Verfügbarkeiten als Zeitfenster** (`availability.windows[]`)
- Felder: `id`, `day`, `kind` (`available`|`unavailable`), `allDay`, `from`, `to`, `sports` mit Optionen (`ride: {indoor, outdoor}`, `strength: {equipment[]}`) und `group` (Sportart, Intensität, Notiz) oder `null`
- Dazu für die ganze Woche: `maxWeeklyHours`, `restDay`, `longDay`
- **Ableitung:** Die Minuten pro Tag ergeben sich aus der Summe der Fenster und landen weiter in `defaultAvailability`. So bleiben die vorhandene Wochenprüfung und das Wochenmaximum ohne Umbau gültig.
- **Gruppentraining** wird beim Planen als feste Einheit in die Woche gesetzt (wie ein eigenes Kalenderworkout) und zählt zu den Stunden.
- **Ausnahmen:** `exceptions[]` mit `from`, `to`, `kind`, `maxMinutes` und `note`. Sie ersetzen Wochen- und Tages-Overrides in der Oberfläche. Intern werden sie auf die vorhandenen Overrides abgebildet.

**4. Plan-Einstellungen** (`plan.settings`)
- `startDate`, `endDate` (ohne Obergrenze)
- `replanMode` (`afterReview`|`sunday`|`manual`)
- `createdAt`

**5. Ultra-Ergänzung in `coach_templates.py`**
- Radeinheiten bis 15 h statt 6 h (`durationMin` bis 900, betrifft die lange Grundlage und Intervall-Einheiten mit Gesamtdauer)
- Rendering-Grenze von 600 min auf 900 min anheben, Verpflegungshinweis für sehr lange Einheiten (ab 6 h) ergänzen
- Fürs NorthCape: Steigerungskette „Back-to-back-Wochenenden“ als Hinweis im wettkampfspezifischen Blocktyp

**6. Pace fürs Laufen**
- Neuer Schwellenwert Schwellenpace (min/km) mit Herkunft: aus Bestzeiten abgeleitet (z. B. 10 km oder Halbmarathon), selbst eingetragen oder Test (30-min-Lauftest in Woche 1)
- Lauf-Templates rechnen ihre Ziele aus der Schwellenpace. Die HF bleibt als Ausweichziel, wenn der Nutzer HF als Primärmetrik wählt oder keine Pace vorliegt.
- Garmin-Export (`workout_export.py`, `garmin_workouts.py`): Pace-Ziele als Geschwindigkeitsbereich ausgeben
- Wochenansicht und Einheitendetail zeigen Pace als „4:35–4:50 /km“

**7. B- und C-Events in der Wochenprüfung**
- Das Event steht als Eintrag `kind: event` in der Woche, nicht als Workout.
- **B mit Mini-Taper:** am Vortag keine harte Einheit, in den 3 Tagen davor höchstens eine kurze Qualitätseinheit, 2 Tage danach nur locker.
- **C mit `replaceHard`:** In dieser Woche gibt es eine Qualitätseinheit weniger.

**8. Modellauswahl:** `gpt-6-astra` zu den Modellvorgaben ergänzen (heute: `gpt-6.1-sol`, `gpt-6-luna` …).

**9. Verbrauch mitschreiben:** Die Token-Angaben (`usage`) jeder Provider-Antwort werden pro Aufruf gespeichert (Art, Modell, Eingabe-, Ausgabe- und Cache-Tokens). Die Einstellungen zeigen damit „Verbrauch diesen Monat“ als echte Zahl statt Schätzung.

**Tests:** Schema, Migration, Ableitung der Minuten aus den Fenstern, Event-Regeln, Ultra-Grenzen, Pace-Ziele und Export.

### M2 Plan erstellen und Nachplanen (Backend)

**`POST /api/coach/plan/create`**
- Erwartet die Planeinstellungen. Profil, Events und Verfügbarkeiten sind vorher gespeichert.
- **Schritt Rahmen:** ein KI-Aufruf mit Phasenfolge und Wochenzielen (Phase, Zielstunden, Fokus, Belastung/Entlastung) für alle Wochen bis zum Planende. Geprüft wird mit Saison- und Blockregeln. Gespeichert werden die Phasen als Blöcke mit Herkunft `plan`.
- **Schritt Wochen:** Wochen 1–3 je ein KI-Aufruf über den vorhandenen Wochenablauf (`kind: week`), werden direkt übernommen, ohne Vorschlag. Fehlt ein Schwellenwert und ist „Testen lassen“ gewählt, steht der Test in Woche 1.
- **Fortschritt:** Die Antwort kommt schrittweise (Server-Sent Events oder Polling auf `GET /api/coach/plan/create/<job>`), damit B7 „Woche 1 ✓ …“ zeigen kann.
- **Fehler:** Bereits gespeicherte Schritte bleiben. „Erneut versuchen“ setzt beim fehlenden Schritt fort.

**`POST /api/coach/plan/advance`**
- Arbeitet die nächste vorgemerkte Woche aus, sodass wieder 3 Wochen fertig sind. Die Woche wird direkt übernommen.
- Wochenrückblick und Check-ins gehen als Kontext mit. Bei starker Abweichung (krank, deutlich weniger) entsteht zusätzlich ein Vorschlag für die schon ausgearbeiteten Wochen.

**Auslöser je `replanMode`**
- `afterReview`: Das Absenden des Wochenrückblicks ruft `advance` auf. Fehlt der Rückblick bis Montag 06:00, löst der nächste App-Aufruf `advance` aus.
- `sunday`: Der erste App-Aufruf ab Sonntag 18:00 löst aus. Einen Server-Scheduler gibt es nicht. Er ist nicht nötig, weil der Plan ohnehin erst beim Öffnen gebraucht wird.
- `manual`: Der Nutzer tippt auf „Nächste Woche planen“.

**`PUT /api/coach/weeks/<week>/review`** erweitert den bisherigen Wochenrückblick (`missed`) um Anstrengung 1–5 und Gründe (Chips).

**Plan neu oder beenden:** `POST /api/coach/plan/reset` beendet laufende Phasen (wie heute Saison löschen mit `blocks=true`). Vergangenes bleibt erhalten.

**Tests:** Rahmen-Prüfung mit Test-Double-Provider, direkte Übernahme, Fortsetzen nach Fehler, 3-Wochen-Horizont, Auslöser je Modus.

### M3 Onboarding (Frontend)

**Neue Komponenten**
- `CoachOnboarding.jsx` mit gemeinsamen Bausteinen: Fortschrittsbalken, Zurück/Weiter, Bottom-Sheet auf dem Handy
- Teil A: `OnboardingSports`, `OnboardingSources` (nutzt `DataHub`, `GarminSync`, `WhoopSync`), `OnboardingThresholds`, `OnboardingProvider` (aus dem heutigen Provider-Tab herausgelöst)
- Teil B: `PlanBackground`, `PlanGoal` + `EventForm`, `PlanSports`, `PlanPeriod` (mit Zeitstrahl), `PlanAvailability` + `AvailabilityForm` (2 Schritte), `PlanReady`, `PlanCreating`

**Entwurf:** Eingaben werden je Schritt gespeichert (Profil, Events, Verfügbarkeiten). Ein Abbruch verliert also nichts. Der Wizard startet beim ersten unvollständigen Schritt.

**Ohne Daten:** B1 zeigt die MATS-Fragen. A3 und B3 bieten „Selbst eintragen“ oder „Testen lassen“ an.

**Tests:** Durchlauf mit und ohne Daten, Event-Formular (4000 km, 10 d 12 h), Verfügbarkeit kopieren, Fehler und erneuter Versuch in B7.

### M4 Plan, Heute und Coach-Chat (Frontend und Backend)

**Plan:** `CoachPlan.jsx`
- Phasenleiste mit Events und Heute
- 3 Wochenkarten, vorgemerkte Wochen, Verlauf
- Einheitendetail mit Verschieben, Tauschen, Auslassen und Behalten
- Verwendet `SessionList` und Timeline-Teile aus `AICoach.jsx`.

**Heute:** `CoachToday.jsx` wird erweitert um die Einordnung („Woche 3 von 40 · Grundlage“), Schnellbuttons bei Gelb oder Rot, den Ausblick auf 3 Tage und Hinweiskarten.

**Chat, Backend**
- Tabelle `coach_chat_message`: `id`, `user_id`, `role`, `text`, `ref`, `proposal_id`, `created_at`
- `GET /api/coach/chat` liefert den Verlauf. `DELETE` steht für „Neuer Chat“ und blendet nur aus.
- `POST /api/coach/chat` mit `{message, ref}`
  - **Kontext:** Snapshot, ausgearbeitete Wochen, Phasen, Events, Verfügbarkeiten, Ampel und Beschwerden, die letzten 20 Nachrichten
  - **Antwortschema:** `{reply, change}`. `change` ist `null`, ein Patch über eine oder mehrere ausgearbeitete Wochen oder ein Einstellungsvorschlag (Verfügbarkeit, Event, Ausnahme, Schwellenwert).
  - Eine Änderung wird als `coach_proposal` mit `kind: chat` gespeichert und mit dem vorhandenen Patch-Prüfer validiert. Verstößt sie gegen eine Regel, wird die Prüfmeldung als Systemhinweis zurückgegeben, und der Coach formuliert eine Alternative (höchstens ein zweiter Versuch).
- Übernehmen und Verwerfen laufen über die vorhandenen Endpunkte `confirm` und `discard`. Ein neuer Vorschlag im selben Chat verwirft den offenen.
- Die Nutzernachricht geht wie bisher der Freitext als Daten (`athleteWish`) an die KI, nicht als Anweisung.
- **Ausnahmen über vorgemerkte Wochen** werden als Einstellungsvorschlag gespeichert. Sie wirken, sobald die Woche ausgearbeitet wird.

**Chat, Frontend:** `CoachChat.jsx` mit Fenster bzw. Sheet, Bezug-Chip, Schnellantworten, Änderungskarte (Vorher/Nachher aus `before` und `after`), Ladezustand und gesperrtem Eingabefeld ohne Provider.

**Tests:** Chat mit Test-Double (Antwort ohne Änderung, mit Patch, Regelverstoß und Alternative), Karte übernehmen und verwerfen, Bezug-Chip, Schnellbutton aus Heute.

### M5 Einstellungen, Umstellung und Aufräumen

- **Einstellungen:** `CoachSettings.jsx` mit den Editoren aus dem Onboarding und „Soll ich deinen Plan anpassen?“ nach planrelevanten Änderungen. Das erzeugt einen Patch-Vorschlag für die ausgearbeiteten Wochen und berechnet bei Event-Änderungen den Rahmen neu.
- **Umstellung:** Die Bereiche Heute, Plan und Einstellungen ersetzen die 6 Tabs in `AICoach.jsx`. `App.jsx` und `Home.jsx` (Check-in-Leiste, Sprung in den Coach) werden angepasst.
- **Bestandsdaten:** Vorhandene Blöcke und Saisonplan erscheinen als Phasen. Fehlen `plan.settings`, werden sie aus Saisonstart und Zieldatum abgeleitet. Ein Onboarding gibt es nur ohne Plan.
- **Entfernen:** Block-Wizard, Saisonplan-Editor, „Wochen angleichen“, Block- und Saison-Vorschlagsarten im UI. Die API-Endpunkte bleiben vorerst für Tests und Bestandsdaten und werden später aufgeräumt.
- **Doku:** `AI-COACH.md` auf den neuen Ablauf umschreiben.

## Reihenfolge und Aufwand (grob)

| Meilenstein | Abhängig von | Aufwand |
| --- | --- | --- |
| M1 Datenmodell und API | – | mittel |
| M2 Plan erstellen und Nachplanen | M1 | groß |
| M3 Onboarding | M1 (M2 für B7) | groß |
| M4 Plan, Heute, Chat | M2 | groß |
| M5 Einstellungen, Umstellung | M3, M4 | mittel |

M2 und M3 können parallel laufen, sobald M1 steht.

## Prüfung je Meilenstein

- Backend: `python -m unittest discover -v` in `backend`
- Frontend: `npm test -- --watchAll=false --runInBand` und `npm run build` in `frontend`
- Ab M2 einmal live mit eigenem Provider-Key: NorthCape-Beispiel aus `coach-ux.md` von A1 bis zum ersten Chat durchspielen. Tests mit Test-Double ersetzen das nicht.

## Kosten (grobe Schätzung)

Preise pro 1 Mio. Tokens (OpenAI, Standard, Stand Oktober 2026): **gpt-6-astra** 10 $ Eingabe / 50 $ Ausgabe, **gpt-6.1-sol** 2 $ / 10 $, **gpt-6-luna** 0,10 $ / 0,50 $.

Die Token-Mengen sind geschätzt und noch nicht gemessen. Gerechnet ist mit dem verdichteten Kontext (Snapshot, Phasen, Wochen, Vorlagen); die Ausgabe enthält Reasoning-Tokens.

| Aktion | Tokens (Ein / Aus) | Astra | Sol | Luna |
| --- | --- | --- | --- | --- |
| Plan erstellen (Rahmen + 3 Wochen) | ca. 50 k / 30 k | ca. 2 $ | ca. 0,40 $ | ca. 0,02 $ |
| Eine Woche nachplanen | ca. 12 k / 3–6 k | 0,25–0,45 $ | 0,05–0,08 $ | < 0,01 $ |
| Eine Chat-Nachricht | ca. 10 k / 1–2 k | 0,15–0,20 $ | 0,03–0,04 $ | < 0,01 $ |
| Typischer Monat (4 Wochen, 30 Chat-Nachrichten) | | ca. 6–8 $ | ca. 1–1,50 $ | ca. 0,10 $ |

Gecachte Eingabe-Tokens (gleichbleibender Kontext im Chat) senken die Eingabekosten deutlich. Die Tabelle rechnet ohne Cache und ist damit eher zu hoch.

**Anzeige im Onboarding (A4)**, unter der Modellauswahl:
> Grobe Kosten über deinen Zugang: Plan erstellen ca. 0,40 $, danach ca. 1–1,50 $ im Monat (gpt-6.1-sol). Mit gpt-6-astra etwa fünfmal so viel, mit gpt-6-luna fast nichts.

Die Zahlen wechseln mit dem gewählten Modell. Nach M1 ersetzen gemessene Werte (Verbrauch mitschreiben) die Schätzung.

## Offene technische Punkte

1. **Zeitfenster und Uhrzeit:** Stufe 1 prüft nur die Minuten pro Tag. Dass eine Einheit genau ins Zeitfenster passt (Uhrzeit), wird nicht erzwungen, außer beim Gruppentraining.
