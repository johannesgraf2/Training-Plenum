# WHOOP-Integration: Übergabe (Stand 2026-10-14)

Dieser Ordner enthält alles, um die WHOOP-4.0-Anbindung an Training Plenum an einem anderen Rechner bzw. Account weiterzuführen.

**Stand:** Phase 1 (Rohdaten), Phase 2 (Auswertung), Phase 3 (Planungs-UI) und Phase 4 (Coach) sind im Code umgesetzt und mit Tests, simulierten Nächten und einem simulierten Strap geprüft, aber **noch nicht mit dem echten Strap**. Nächster Schritt ist der Test auf dem Mac (siehe `whoop-bridge/README.md`, Abschnitt „Erster Test“). Phase 5 (v2-Kennzahlen) ist bewusst offen.

### Abweichungen vom Plan in Phase 1
- `whoop_hour` speichert die **Schwerkraftvektoren** (1/10000 g) statt eines fertigen Bewegungswerts. So lassen sich Chunks in beliebiger Reihenfolge zusammenführen; Phase 2 berechnet die Bewegung aus aufeinanderfolgenden Vektoren (`whoop_sync.hour_view`).
- „Dirty days“ gibt es nicht als eigene Tabelle: `whoop_hour.updated_at` zeigt, welche Stunden sich seit der letzten Berechnung geändert haben.
- `POST /api/whoop/recompute` dekodiert in Phase 1 die aufbewahrten Rohdaten neu (für Decoder-Korrekturen). In Phase 2 kommt die Neuberechnung von `whoop_day` dazu.
- Heartbeat alle 30 s statt 60 s, damit „Jetzt synchronisieren“ schneller ankommt.
- Kommando 96 steht zusätzlich auf der Sperrliste („Never 96“ aus der Recherche).
- Spalte `retention_days` entfällt; die Aufbewahrung kommt nur aus `WHOOP_RAW_RETENTION_DAYS`.
### Abweichungen und Festlegungen in Phase 2
- `whoop_day` speichert `nightly` (Schlaf, HRV, Ruhepuls, Strain) und `scores` (Baselines, Readiness, Schlafschuld) als JSON statt als Einzelspalten, damit spätere Kennzahlen keine Migration brauchen.
- Zwei Stufen: `nightly` wird nur für Tage neu berechnet, deren Stunden sich seit dem letzten Lauf geändert haben (eine Stunde markiert ihren Tag und beide Nachbartage), `scores` immer über alle Tage. Ändert sich HFmax im Profil, wird alles neu berechnet.
- Als Schlaf zählen nur stille Zeiten **mit Hautkontakt und Herzfrequenz**; ein Strap auf dem Tisch ist sonst auch „still“.
- Die Baseline startet mit dem einfachen Mittel und der mittleren Abweichung der ersten vier Nächte; danach winsorisierte EWMA wie geplant. z-Werte werden auf ±3 begrenzt.
- Readiness braucht HRV oder Ruhepuls; Schlaf allein ergibt keine Zahl. Die Kalibrierung zählt Nächte mit gültiger HRV.
- Strain ohne HFmax im Profil nutzt Tanaka (208 − 0,7 × Alter). Ruhepuls dafür aus der Nacht, sonst das 10. Perzentil des Tages.
- Zeitzone für die Zuordnung der Nächte: `TRAINHUB_TIMEZONE` (Standard `Europe/Berlin`).
- `POST /api/whoop/recompute` liest die aufbewahrten Rohdaten neu ein und berechnet danach alle Tage neu.
- Behoben: Das Zusammenführen von R-R-Werten in Phase 1 war quadratisch langsam.

### Abweichungen und Festlegungen in Phase 3
- Die Tageswerte lädt `App.jsx` einmal über `/api/whoop/days` (400 Tage) und gibt sie an Startseite, Kalender und Dashboard weiter; `/api/analytics` bleibt unverändert. Neu geladen wird, wenn sich `analytics.computedAt` im Status ändert (Abfrage alle 5 min, beim Fokussieren des Fensters und nach dem Schließen des WHOOP-Fensters).
- **Planungshinweis** (`Recovery.jsx`, `planningHint`): Readiness rot und heute eine Einheit mit Intervallschritten → „Heute lieber locker“ mit Tauschvorschlag (nächster der drei Folgetage ohne Intervalle); rot ohne harte Einheit → locker halten; HRV unter dem Normalbereich (Baseline ± 1 SD) und eine harte Einheit → Intensität reduzieren. Nichts während der Kalibrierung und nichts bei Grün.
- **Ohne TSB:** Dieses Repo berechnet nur Fitness (CTL), keine Ermüdung/Form (ATL/TSB); die gibt es nur in der Mac-Version. Die Regel „HRV unter Normalbereich und negative TSB“ kommt deshalb erst mit Phase 4 bzw. nach dem Zusammenführen.
- „Im AI Coach anpassen“ öffnet die Plan-Seite des Coachs („Woche anpassen“); ein vorbefüllter Patch-Auftrag folgt in Phase 4.
- Dashboard: Die Erholungs-Karte teilt sich den Zeitraum mit der Fitness-Karte und nutzt dieselbe x-Geometrie, damit beide Diagramme dieselben Tage zeigen.
- Ohne WHOOP-Daten erscheinen weder Kachel noch Hinweis noch Karte.

### Abweichungen und Festlegungen in Phase 4
- **Form (TSB) gibt es jetzt auch in diesem Repo:** `analytics.fitness()` liefert zusätzlich `fatigue` (ATL, 7 Tage), `form` und `fatigueWindow`, pro Tag und aktuell, in derselben Form wie die Mac-Version. Form = Fitness − Ermüdung **zu Tagesbeginn** (vor der Belastung des Tages). Das Dashboard zeigt weiterhin nur die Fitness.
- **Snapshot:** `build_snapshot(..., wearable_days=...)` ergänzt `observed.trainingLoad` (immer) und `observed.wearable` (nur mit WHOOP-Nächten der letzten 14 Tage, `source: 'device'`), dazu Definitionen in `dataQuality.definitions`. Die Nächte liest `coach_api` über `app.extensions['whoop_days']` aus `whoop_sync.py`; ohne WHOOP-Modul oder Daten fehlt der Abschnitt.
- **Planungsregel serverseitig:** `wearable.signals` rechnet die Regel aus (Readiness rot, oder HRV unter dem Normalbereich **und** negative Form → `reduceIntensityToday`), damit das Modell sie nicht selbst herleiten muss. Nichts während der Kalibrierung und nichts, wenn für heute keine Nacht vorliegt.
- **Woche und Patch** erhalten `trainingLoad` und, mit Daten, `recentRecovery` (gleiches Format wie `observed.wearable`), statt eines separaten `recentRecovery`-Formats. Block und Saison bekommen beides über den Snapshot.
- **Fingerprint:** WHOOP-Nächte gehören bewusst **nicht** dazu. Jeden Morgen kommt eine neue Nacht; offene Vorschläge sollen dadurch nicht ungültig werden.
- **Vorbefüllter Patch-Auftrag:** „Im AI Coach anpassen“ am Planungshinweis öffnet den Coach auf der laufenden Woche und setzt einen deutschen Wunsch (z. B. „Meine Readiness ist heute rot (28). Mach „Schwelle“ (Mittwoch) bitte zu einer lockeren Einheit, oder tausche sie mit Freitag.“). Gesendet wird erst mit „Woche anpassen“, damit kein API-Aufruf ohne Bestätigung entsteht.
- Unter „Datenbasis & Herkunft“ im Coach stehen jetzt Form und eine Zeile „WHOOP-Erholung“, damit sichtbar ist, was der Coach bekommt.
- Der Planungshinweis auf der Startseite (Phase 3) nutzt die Form weiterhin nicht; er bleibt bei „HRV unter Normalbereich und harte Einheit“ mit weicher Formulierung. Die strengere Regel mit Form gilt im Coach.

### Repo-Stand
- Das GitHub-Repo war älter als die Mac-Kopie (kein `garmin_sync.py`, `wsgi.py`, `backup.py`). Phase 1 baut auf dem Repo-Stand auf; beim Zusammenführen mit der Mac-Kopie gehören `start_whoop_worker(app)` zusätzlich in `wsgi.py` und `/api/whoop` in die Garmin-erweiterte Guard-Liste in `coach_api.py`.

## Dateien
| Datei | Inhalt |
|---|---|
| `PLAN.md` | Freigegebener Umsetzungsplan: Architektur, neue und geänderte Dateien, Phasen, Risiken, Tests |
| `RESEARCH-WHOOP4-PROTOCOL.md` | Bluetooth-Protokoll des WHOOP 4.0 (UUIDs, Frames, CRCs, Kommandos, Record-Layouts, Testfixtures) |
| `RESEARCH-ANALYTICS.md` | Methoden und Konstanten für HRV, Ruhepuls, Schlaf, Readiness, Strain und Schlafschuld |
| `RESEARCH-TP-INTEGRATION.md` | Andockstellen im Training-Plenum-Code mit Datei:Zeile |

## Bisher getroffene Entscheidungen
1. **Training Plenum ist die einzige Oberfläche.** Weder noop noch die WHOOP-App werden genutzt. Alle Einstellungen, der Status und alle Auswertungen laufen in TP und dienen der Trainingsplanung (Kalender, Heute, Dashboard, AI Coach).
2. **Strap:** WHOOP **4.0**.
3. **TP läuft auf einem Mac zu Hause.** Docker auf dem Mac hat keinen Bluetooth-Zugriff. Deshalb gibt es einen kleinen **Bridge-Dienst ohne eigene Oberfläche** (`whoop-bridge/`, Python + bleak, per launchd), der die Daten an TP schickt.
4. **Der Strap wird von der offiziellen WHOOP-App getrennt.** Das ist für Johannes ok: Danach erhalten die WHOOP-App und die WHOOP-Cloud keine Daten mehr.
5. **Kein noop-Code wird übernommen.** noop steht unter PolyForm Noncommercial. Wir nutzen nur die ausdrücklich freigegebenen Protokoll-Fakten und publizierte Methoden und schreiben eigenen Code.
6. **noops „Self-Hosted Push“ wurde verworfen.** Er setzt die noop-App als Oberfläche voraus und funktioniert bisher nur unter Android.
7. **Die Werte sind eigene Näherungen,** keine offiziellen WHOOP-Scores. Die UI beschriftet sie so.
8. **Die TRIMP aus WHOOP fließt in v1 nicht in CTL/ATL/TSB ein,** weil sie sonst doppelt zu den Garmin-Aktivitäten zählen würde.

## Zuhause zuerst klären
- **Docker oder nativ:** Läuft TP auf dem Mac per Docker (`docker-compose.yml`) oder nativ? Die Bridge funktioniert in beiden Fällen, es ändert sich nur die URL (`http://localhost[:PORT]`).
- **Git:** Der Projektordner ist **kein Git-Repo**. Vor dem Start `git init` ausführen und den aktuellen Stand committen, damit jede Phase sauber nachvollziehbar ist.
- **Python für die Bridge:** Auf dem Mac muss Python 3.11+ für die Bridge vorhanden sein (Homebrew oder python.org).

## Nächster Schritt: Phase 1
Protokollmodul mit Tests, Bridge, Rohdaten-Empfang im Backend und ein schlankes WHOOP-Fenster.

**Meilenstein:** Der echte Strap liefert Herzfrequenz- und RR-Daten, und TP zeigt „Daten bis …“ an. Danach folgen Analytik (Phase 2), Planungs-UI (Phase 3) und Coach (Phase 4).

## Prompt zum Weitermachen (in Claude Code im Projektordner einfügen)
```
Lies docs/whoop-integration/START-HERE.md, PLAN.md und die drei RESEARCH-*.md.
Setze Phase 1 aus PLAN.md um: backend/whoop_protocol.py mit test_whoop_protocol.py
(nutze die Fixtures aus RESEARCH-WHOOP4-PROTOCOL.md §6), dann whoop-bridge/
(bridge.py, requirements.txt, install-mac.sh, README.md), dann backend/whoop_sync.py
mit test_whoop_sync.py nach dem Muster von garmin_sync.py, die Guard-Anpassung in
coach_api.py, das Starten des Workers in wsgi.py/app.py und ein schlankes
frontend/src/WhoopSync.jsx plus den Menüeintrag. UI-Texte auf Deutsch wie im Rest der App.
Kopiere keinen noop-Code, nur die dokumentierten Protokoll-Fakten.
Lass am Ende alle Backend- und Frontend-Tests laufen und sag mir, wie ich die Bridge
auf meinem Mac mit dem echten Strap teste.
```

## Quellen
- **noop:** https://github.com/ryanbr/noop (Protokoll-Doku unter `docs/PROTOCOL*.md`, Analytik unter `docs/ANALYTICS.md`, Lizenz unter `LICENSE`)
- **Vorarbeiten, auf die noop aufbaut:** `johnmiddleton12/my-whoop` (WHOOP 4) und `b-nnett/goose` (WHOOP 5). Die Lizenzen beider Projekte wurden nicht geprüft; deren Code wird nicht verwendet.
