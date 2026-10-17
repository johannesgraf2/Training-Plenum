# AI Coach: Einrichtung, Daten und API

TrainHub liefert einen verdichteten Athletenkontext und rendert geplante Einheiten deterministisch. Der AI-Provider entscheidet über Trainingsphasen, Wochenumfang und Template-Auswahl. Der erste Plan ist nach der Zusammenfassung im Onboarding sofort aktiv; jede spätere Änderung an ausgearbeiteten Wochen bleibt ein Vorschlag mit Vorher/Nachher, bis der Athlet sie ausdrücklich übernimmt.

## Einrichtung und erster Plan

1. Backend-Abhängigkeiten aktualisieren: `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt` aus dem TrainHub-Verzeichnis. Die Erweiterung benötigt zusätzlich `cryptography` und `jsonschema`.
2. Den Serverschlüssel für gespeicherte API-Keys legt TrainHub selbst an: Ist `TRAINHUB_AI_ENCRYPTION_KEY` nicht gesetzt, liest das Backend beim Start `.run/ai-encryption-key.txt` im TrainHub-Verzeichnis und erzeugt die Datei einmalig, falls sie fehlt. `.run/` ist von Git ausgeschlossen. Eine vorhandene Datei wird nie überschrieben, auch keine ungültige; **Einstellungen → AI-Provider** meldet sie dann. Dort steht außerdem, woher der Schlüssel stammt und wo die Datei liegt. Der Schlüssel ist ein Servergeheimnis und kein OpenAI-API-Key.
3. Die Schlüsseldatei getrennt von der Datenbank sichern. Wer den Schlüssel selbst verwalten möchte, setzt `TRAINHUB_AI_ENCRYPTION_KEY` in der Umgebung des Backend-Prozesses; die Variable hat Vorrang vor der Datei. `TRAINHUB_AI_ENCRYPTION_KEY_FILE` wählt einen anderen Dateipfad. Im Docker-Setup liegt die Datei über diese Variable unter `/app/data/ai-encryption-key.txt`, also neben der Datenbank im gemounteten `backend/data`. Einen eigenen Schlüssel erzeugt:

   ```powershell
   backend/.venv/Scripts/python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Ein bereits laufendes Backend muss neu gestartet werden, damit es einen geänderten Schlüssel übernimmt. `start-local.ps1` ersetzt einen bereits auf Port 5000 laufenden Prozess nicht.
4. Nach Frontend-Änderungen in `frontend` mit `npm run build` neu bauen. Backend wie gewohnt über `app.py` starten; dessen Initialisierung ergänzt die Coach-Tabellen und das `locked`-Feld vorhandener geplanter Workouts.
5. **AI Coach** öffnen. Ohne Plan zeigen **Heute** und **Plan** die Karte **Lass uns deinen Plan bauen**. Sie startet das Onboarding: Teil A (Sportarten, Datenquellen, Leistungsdaten, AI-Provider) und Teil B (Hintergrund, Ziel und Events, Sportarten im Plan, Zeitraum, Verfügbarkeiten als Zeitfenster, Zusammenfassung). Jeder Schritt speichert sofort; wer abbricht, macht beim ersten offenen Schritt weiter.
6. Im Schritt **AI-Provider** (oder später unter **Einstellungen → AI-Provider**) den eigenen API-Key und eine Modell-ID speichern und die Verbindung testen. Aktuell ist OpenAI implementiert; das Modell wird aus einer Liste gewählt (Vorgabe im Code: `gpt-4.1-mini`), über „Anderes Modell …“ lässt sich jede andere Modell-ID eintragen. Für Reasoning-Modelle (z. B. `gpt-6-sol`) kann zusätzlich eine Reasoning-Stufe gewählt werden; sie wird als `reasoning.effort` gesendet, zusammen mit mehr Ausgabebudget (40.000 Tokens) und bis zu 5 Minuten Wartezeit. Unter der Modellauswahl steht eine grobe Kostenschätzung, in den Einstellungen zusätzlich der gemessene **Verbrauch diesen Monat**. Die Liste ist keine live abgefragte Liste verfügbarer Modelle. Der Account muss Zugriff auf das gewählte Modell haben, und das Modell muss die verwendeten strukturierten Responses unterstützen. Die Anzeige oben rechts („Provider einrichten“ bzw. „Provider verbunden · Modell“) öffnet diesen Bereich ebenfalls.
7. **Los geht's** in der Zusammenfassung erstellt den Plan: Der Coach legt die Phasen bis zum Planende fest und arbeitet die ersten 3 Wochen aus. Die Workouts stehen direkt im Kalender.

Ein Verbindungstest prüft API-Key und Zugriff auf die Modell-ID über den Modell-Endpunkt. Er erzeugt keinen Plan und bestätigt noch nicht, dass eine konkrete Planungsanfrage mit dem Schema erfolgreich sein wird. Generierungen werden über den eigenen Provider-Zugang abgerechnet.

## Bereiche des Coachs

Der Coach hat drei Bereiche, dazu den Coach-Chat:

| Bereich | Inhalt |
| --- | --- |
| **Heute** | Check-in und Tagesampel, Einordnung („Woche 3 von 19 · Grundlage“), heutige Einheiten, bei Gelb oder Rot Schnellbuttons in den Chat, Ausblick auf 3 Tage, Hinweiskarten und Beschwerden. Ohne Plan die Startkarte zum Onboarding. |
| **Plan** | Countdown, Phasenleiste, die 3 ausgearbeiteten Wochen, vorgemerkte Wochen, Wochenrückblick und **Verlauf** (geplant gegen absolviert, Check-in-Verlauf). Details siehe „Plan, Heute und Coach-Chat“. |
| **Einstellungen** | Dieselben Editoren wie im Onboarding, einzeln erreichbar, siehe „Einstellungen und Plan anpassen“. |

Die früheren Tabs gehen darin auf: Woche, Saison und Rückblick im Plan, Athletenprofil und AI Provider in den Einstellungen. Wer die App mit einem früheren Tab öffnet (`initialTab` `week`, `season`, `review`, `profile`, `provider`), landet im passenden neuen Bereich. Block-Wizard, Saisonplan-Editor, „Wochen angleichen“ und die Block- und Saisonvorschläge gibt es in der Oberfläche nicht mehr; Änderungen am Plan laufen über den Coach-Chat.

## Einstellungen und Plan anpassen

`CoachSettings.jsx` zeigt einen Abschnitt nach dem anderen:

| Abschnitt | Inhalt |
| --- | --- |
| Athletenprofil | Regelmäßige Sportarten (`sports`), Gewicht, Alter, Einschränkungen und aktueller Zustand. |
| Sportarten im Plan | Rad, Laufen (`goal.sports`) und Kraft (`preferences.gymAvailability`) mit Primärmetrik je Sportart; Sportarten kommender Events sind gesperrt. |
| Leistungsdaten | FTP und Schwellenpace mit Herkunft („Aus deinen Daten“, „Selbst eintragen“, „Testen lassen“) sowie max. HF. |
| Verfügbarkeiten | Zeitfenster je Wochentag wie in B5, Wochenmaximum, Ruhetage, „Zwei Ruhetage hintereinander“, Tage für die lange Einheit, empfohlene Wochenstunden und **Ausnahmen** (von–bis, „Keine Zeit“ oder „Weniger Zeit“ mit Minuten pro Tag, Notiz). |
| Events & Ziele | Events anlegen, bearbeiten, löschen; ohne A-Event ein Ziel ohne Event; das Planende eines laufenden Plans. Das letzte kommende A-Event wird zusätzlich als `goal` (Name, Datum) gespeichert, die Startseite zählt darauf herunter. |
| Datenquellen | Garmin, WHOOP, Dateien und die Datenbasis mit dem kompakten Snapshot. |
| AI-Provider | Provider, Modell, Key, Verbindungstest, Kostenschätzung und Verbrauch diesen Monat (`GET /api/coach/usage`). |
| Coach-Verhalten | Nachplanen (`afterReview`, `sunday`, `manual`) und Morgen-Check-in an/aus. |
| Plan | **Plan neu erstellen** (beendet den laufenden Plan und startet das Onboarding beim Zeitraum, alle anderen Angaben sind vorausgefüllt) und **Plan beenden**. |

**Soll ich deinen Plan daran anpassen?** Nach dem Speichern planrelevanter Änderungen (Verfügbarkeiten, Events, Leistungsdaten, Sportarten im Plan, Planende) fragt der Coach nach, solange ein Plan läuft. Weitere Änderungen sammeln sich in derselben Frage.

- **Ja, Plan anpassen** ruft `POST /api/coach/plan/adapt` mit den geänderten Bereichen (`changes`) auf und wechselt in den Plan, der den Fortschritt zeigt. Der Job hat bis zu zwei Schritte: **Phasen neu festlegen** (nur bei Events oder Planende) legt die Phasen ab der ersten Woche nach den ausgearbeiteten Wochen bis zum Planende mit einem AI-Aufruf neu fest; die laufende Phase endet davor, frühere Phasen bleiben. **Ausgearbeitete Wochen prüfen** gibt die ausgearbeiteten Wochen mit ihren aktuellen Regeln in einem AI-Aufruf an die KI. Wochen, die sich ändern sollen, werden geprüft und als Vorschlag `kind: "weeks"` mit `reason: "settings"` gespeichert; der Plan zeigt ihn als Änderungskarte mit Vorher/Nachher. Wochen, die weiter passen, bleiben unverändert.
- **Später** speichert die Bereiche in `plan.adapt`. Der Plan zeigt dann „Deine Einstellungen haben sich geändert“ mit **Plan anpassen**. Ein erfolgreicher Durchlauf löscht den Hinweis, ein fehlgeschlagener lässt ihn stehen.
- Der Start eines laufenden Plans bleibt fest; `PUT /api/coach/plan/settings` lehnt einen anderen Start ab. Für einen neuen Start wird der Plan neu erstellt.

**Bestandsdaten:** Laufende und kommende Trainingsblöcke aus der Zeit vor den Phasen erscheinen als Phasen eines Plans (`plan.frame.source: "adopted"`), zusammen mit den Blöcken des Saisonplans, die danach noch offen sind. Diese bekommen den vorgeschlagenen Rhythmus ihres Typs und den Wunschumfang als Zielstunden. Fehlen `plan.settings`, beginnen sie mit dem Saisonstart (bzw. dem ersten dieser Blöcke) und enden mit dem letzten Block; Nachplanen steht auf `afterReview`. Die Übernahme geschieht beim Lesen und wird mit der nächsten Änderung gespeichert; der Saisonplan bleibt als Datensatz erhalten. Ein Onboarding gibt es nur ohne Plan: Ohne laufenden oder kommenden Block (auch bei einem Saisonplan, dessen erster Block nie angelegt wurde) und nach **Plan beenden** startet es über die Karte in Heute.

## Architektur und Speicherung

| Modul | Verantwortung |
| --- | --- |
| `backend/athlete_context.py` | Reine Berechnung des Snapshots und abgeschlossener Zeiträume aus vorhandenen Cache-Zusammenfassungen; kein Datenbank- oder Providerzugriff. |
| `backend/analytics.py`, `backend/best_efforts.py` | Bestehende deterministische Sensor-, Zonen-, Normalized-Power- und Bestwertberechnungen mit versionierten Aktivitäts-Caches. |
| `backend/coach_domain.py` | JSON-Schemas, Athletenangaben, ISO-Wochen, effektive Verfügbarkeit und Patch-Operationen. |
| `backend/coach_blocks.py` | Blocktyp-Katalog mit Längen, Rhythmus und Prüfregeln (die Regeln der Phasen), gespeicherte Blöcke und Migration früherer Makropläne. |
| `backend/coach_plan.py` | Plan mit Phasen: Prüfung des Rahmens, rollierender Horizont, Nachplanen, Gruppentraining, Übernahme früherer Blöcke als Phasen und Neuzuschnitt der Phasen beim Anpassen. |
| `backend/coach_chat.py` | Schema und Prüfung der Chat-Antworten, Einstellungsänderungen aus dem Chat. |
| `backend/coach_season.py` | Früherer Saisonplan: Blockfolge bis zum Ziel und Prüfregeln; bleibt für Bestandsdaten und die bisherigen Endpunkte. |
| `backend/coach_templates.py` | Template-Katalog, Parametergrenzen, konkrete Dauer und Watt-/HF-Ziele sowie geschätzte geplante Cycling-TSS. |
| `backend/ai_provider.py` | Provider-Abstraktion, Fernet-Ver-/Entschlüsselung, OpenAI-Adapter und Prüfung strukturierter Antworten. |
| `backend/coach_api.py` | Persistenz, Kontext-Auswahl, Jobs (Plan erstellen, Nachplanen, Anpassen), Vorschläge, serverseitige Beschränkungen, Fixierungen und ausdrückliche Übernahme. |
| `frontend/src/AICoach.jsx` | Bereiche Heute, Plan und Einstellungen, Jobs verfolgen, Check-in, Chat und Onboarding öffnen. |
| `frontend/src/CoachOnboarding.jsx`, `PlanSteps.jsx`, `OnboardingUI.jsx` | Onboarding Teil A und B und die Editoren, die auch die Einstellungen verwenden. |
| `frontend/src/CoachSettings.jsx` | Einstellungen mit „Soll ich deinen Plan daran anpassen?“. |
| `frontend/src/CoachPlan.jsx`, `CoachToday.jsx`, `CoachChat.jsx` | Plan, Tagesansicht mit Check-in und Coach-Chat. |

`athlete_coach_state` speichert Athletenangaben, die Phasen als Trainingsblöcke (`blocks[]`), den Plan (`frame`, `settings`, optional `adapt`), konkrete Wochen, optional einen früheren Saisonplan (`season`) und eine Revision. `ai_provider_settings` speichert Provider, Modell, verschlüsselten API-Key und die letzten vier Zeichen. `coach_proposal` speichert Vorschläge mit Status, Erstellungszeit und einem Fingerabdruck des Ausgangszustands. Bestätigte Rad- und Laufeinheiten verwenden die bestehende Tabelle `planned_workout`; importierte Aktivitäten bleiben davon getrennt.

Das vorhandene `training_plan.py` wurde geprüft: Es enthält deterministische Logik für einen bestehenden vierwöchigen Radtrainingsblock und erzeugt validierte Workouts innerhalb des Backends. Es ist kein separater externer AI-Workflow und bleibt für die bestehenden Abläufe erhalten. Der neue AI Coach verwendet die gemeinsame Analytics- und Workout-Infrastruktur.

## Phasen und Blockregeln

Phasen werden intern als Trainingsblöcke gespeichert. Ein Trainingsblock hat einen Haupttyp, optional einen Nebenschwerpunkt, einen Startmontag, 1–12 Wochen (ein übernommener Makroplan auch mehr) mit Phase (`base`, `build`, `peak`, `taper`, `recovery`), Zielstunden und Fokus sowie einen Status. Die Regeln stehen zentral in `coach_blocks.py`. `recovery` und `taper` gelten als Entlastungswochen; dort entfallen Mindestanzahlen.

| Typ | Wochen (Standard) | Regeln |
| --- | --- | --- |
| `wiedereinstieg` Wiedereinstieg | 2–4 (3) | Keine VO2max- oder Schwelleneinheit, höchstens 1× Tempo/Sweetspot pro Woche. |
| `grundlage` Grundlage | 6–12 (8) | Keine VO2max-Einheit, höchstens 1 Qualitätseinheit pro Woche, mindestens 80 % der Rad-/Laufzeit locker. |
| `aufbau` Aufbau | 4–12 (6) | Mindestens 2 Qualitätseinheiten pro Belastungswoche, höchstens 1× VO2max. |
| `schwelle` Schwelle | 4–12 (6) | Mindestens 2 Schwellen-/Sweetspot-Einheiten pro Belastungswoche, höchstens 1× VO2max. |
| `vo2max` VO2max | 3–12 (4) | Mindestens 2 VO2max-Einheiten pro Belastungswoche, höchstens 1 Schwellen-/Sweetspot-Einheit. |
| `wettkampfspezifisch` Wettkampfspezifisch | 2–12 (4) | Endet spätestens in der Woche des Zieldatums, letzte Woche mindestens 30 % weniger Umfang als die stärkste Woche davor. |
| `taper` Taper | 1–3 (1) | Jede Woche Entlastung (Phase `taper`), höchstens 2 Qualitätseinheiten pro Woche als kurze Reize, jede Woche höchstens 70 % des Wunschumfangs, endet spätestens in der Woche des Zieldatums. Im Saisonplan direkt nach Wettkampfspezifisch. |
| `uebergang` Übergang | 1–4 (2) | Keine Qualitätseinheiten, jede Woche höchstens 60 % des Wunschumfangs, kein Entlastungsrhythmus. |

Außer beim Übergang endet jeder Block mit einer Entlastungswoche, und auf höchstens drei Belastungswochen folgt eine Entlastung. Der vorgeschlagene Rhythmus ist 3:1; kürzere Blöcke verwenden 2:1 bzw. passende kürzere Zyklen (5 Wochen: Belastung, Belastung, Entlastung, Belastung, Entlastung). Als Nebenschwerpunkt stehen `kraft`, `laufen` und `radfahren` zur Auswahl; er verlangt mindestens eine passende Einheit pro Belastungswoche, `kraft` zusätzlich die Krafttraining-Verfügbarkeit.

Der Status ist `active`, `completed` (Enddatum vorbei, berechnet) oder `abandoned`. Beginnt ein neuer Block, während ein anderer noch läuft oder bevorsteht, endet dieser am Vortag und gilt als `abandoned`; bereits geplante Wochen gehören weiter zu ihm und bleiben per **Woche anpassen** änderbar. Blöcke, die erst nach dem neuen Block beginnen, bleiben unverändert, so lässt sich eine Saison Block für Block im Voraus anlegen. Ein neuer Block darf keine bereits geplante Kalenderwoche überdecken und keinen Block abschneiden, der nach seinem Ende noch geplante Wochen hat; dieser muss zuerst gelöscht werden.

Ein früher gespeicherter Makroplan wird beim Lesen zu einem Block vom Typ `custom` („Eigener Block“, ohne Typregeln) mit der festen ID `custom-<Startdatum>` und bei der nächsten bestätigten Änderung im neuen Format gespeichert. `custom` kann für neue Blöcke nicht gewählt werden.

### Früherer Ablauf: Block- und Saisonvorschläge

Die Oberfläche bietet einzelne Blöcke und Saisonpläne nicht mehr an; die Endpunkte bleiben vorerst für Tests und Bestandsdaten.

| Modus | Anfrage | Antwort und Prüfung |
| --- | --- | --- |
| `recommend` („Schlag mir was vor“) | `situation` (`nach_pause`, `mitten_im_training`, `saison_vorbei`) und `startDate` | 2–3 Optionen, genau eine mit `recommended: true`, jede mit kurzer deutscher Begründung (`rationale`). Verletzt eine Alternative die Regeln, wird sie verworfen und unter `rejectedOptions` mit Grund genannt; eine fehlerhafte Empfehlung lässt den ganzen Vorschlag scheitern. |
| `choose` („Ich weiß, was ich will“) | `blockType`, `secondaryFocus` (oder `null`), `startDate`, `weeks`, optional `design` | Genau eine Option desselben Typs, Nebenschwerpunkts und derselben Länge. Die KI entscheidet nur Umfang, Verteilung, Entlastung und Fokus. Typ, Länge, Kraft-Verfügbarkeit und Zieldatum werden schon vor dem kostenpflichtigen Aufruf geprüft. |

Der Blocktyp geht immer strukturiert an die KI. Ein Freitext (`instruction`) erreicht sie als `athleteWish` mit Herkunft `athlete` und präzisiert die Anfrage nur; er ist Datenmaterial, keine Anweisung. Jede Option durchläuft die Blockregeln, die Verfügbarkeit jeder Woche, das Wochenmaximum und die Platzierung neben bestehenden Blöcken.

Block-, Wochen- und Patch-Antworten enthalten `hinweise[]`: kurze deutsche Bedenken der KI, zum Beispiel zu geringem Umfang in der letzten Woche. Sie werden angezeigt, blockieren aber nichts. Harte Grenzen prüft ausschließlich der Server. Beim Planen und Anpassen einer Woche gelten zusätzlich die Wochenregeln des Blocktyps aus der Tabelle oben.

### Trainingsgrundsätze und Steigerungsketten

Die KI plant nach festen Grundsätzen: Der Großteil des Umfangs ist locker, wenige harte Einheiten setzen gezielte Reize. Steigerung heißt mehr Zeit im Zielbereich (mehr Wiederholungen, Sätze oder längere Intervalle), nicht höhere Watt; die Intensität ist so gewählt, dass auch die letzte Wiederholung kontrolliert bleibt. Formate mit demselben Ziel wechseln sich ab. Jeder Blocktyp nennt der KI typische Steigerungsketten, zum Beispiel im VO₂max-Block 5×3 → 5×5 → 5×6/6×5 min und 3×9 → 3×11 → 3×13 × 30/15, später 3×10 × 40/20, begleitet von 1–3 h lockeren Fahrten und gelegentlichen SIT; im Grundlagenblock wächst die lange Fahrt von 1:30 auf 3 h. Die Ketten stehen in `coach_blocks.py` und sind Hinweise, keine harten Regeln.

## Früherer Saisonplan

Ein Saisonplan teilte die Zeit bis zum Zieldatum in Trainingsblöcke (Grundlage, VO2max, Schwelle, Wettkampfspezifisch, optional Taper), die Block für Block angelegt wurden. Mit dem Plan mit Phasen erscheinen seine offenen Blöcke als Phasen (siehe „Bestandsdaten“). `POST /api/coach/proposals` mit `kind: "season"`, `PUT/DELETE /api/coach/season` und die Regeln in `coach_season.py` bleiben vorerst für Tests und Bestandsdaten.

## Athlete Snapshot und Datenherkunft

`GET /api/athlete-snapshot?timezone=Europe%2FBerlin` liefert `schemaVersion`, `asOf`, `timezone` und die Bereiche `athlete`, `observed`, `selfReported`, `dataQuality`.

| Herkunft | Bedeutung |
| --- | --- |
| `calculated` | Aus den gespeicherten Trainingsdaten berechnet. |
| `athlete` | Vom Athleten eingetragen, einschließlich Alter, Gewicht, FTP, maximaler HF, Zielen, Verfügbarkeit und Check-ins. |
| `aiRecommendation` | Vom Provider empfohlene Planentscheidungen. |

Die `source`-Markierung eines Snapshot-Bereichs gilt für seine enthaltenen Felder. Eine eingetragene FTP ist keine automatisch gemessene FTP; subjektive Müdigkeit ist kein berechneter Fitnesswert. Die gerenderten Dauern und Belastungsschätzungen zu einer Empfehlung berechnet TrainHub aus deren Templates.

`observed.currentTraining` enthält die letzten 7, 28 und 42 lokalen Kalendertage einschließlich `asOf`: Trainingsstunden, verschiedene Aktivitäten und Sport-Sessions, Kilometer, Höhenmeter, Sportanteile, Zonenzeiten, getrennte Intensitätsanteile und gegebenenfalls Cycling-TSS. Multisport-Sessions zählen einzeln für die Sportverteilung, ihre gemeinsame Aktivität zählt nur einmal. Sportanteile verwenden bekannte Trainingssekunden als Nenner.

`observed.performanceHistory.bestEfforts` trennt `allTime`, `last365Days` und `last90Days`, jeweils mit `cycling` und `running`. Ein Eintrag enthält Watt bzw. Laufzeit in Sekunden, lokales Datum, `ageDays` und die Aktivitäts-ID. Fehlende Leistungen werden nicht ersetzt. Die Radziele reichen von `30s` bis `60min`; Laufziele reichen von `400m` bis `21km` (genau 21.000 m). Bei gleichem Bestwert wird das jüngere Datum verwendet.

Importierte UTC-Zeitstempel werden in die gewählte Zeitzone umgerechnet. Ältere manuelle Daten behalten ihre lokale Uhrzeit. Rollierende Zeiträume haben inklusive Datumsgrenzen; zukünftige Datensätze werden ausgeschlossen. Datums- und Zeitperioden werden damit auch an Sommerzeitgrenzen als Kalendertage behandelt.

### Trainingshistorie und beobachteter Umfang

`observed.trainingHistory.last365Days.trainingHours` umfasst alle 365 Tage einschließlich des laufenden Tages. Wochenmittel, Median, Maximum und `activeWeeks` beziehen sich dagegen auf vollständig enthaltene Montag–Sonntag-Wochen, ohne laufende oder angeschnittene Woche. Kalenderwochen ohne gespeicherte Aktivitäten zählen mit null Stunden. Fehlende Dauern führen zu ausdrücklich unbekannten Wochenstatistiken.

`observed.observedTrainingCapacity` liefert `maxSingleWeekHours`, `max4WeekAverageHours`, `max6WeekAverageHours` und `max8WeekAverageHours` über die gesamte vorhandene Historie. Gezählt werden vollständige Kalenderwochen ab dem frühesten aufgezeichneten Aktivitätsdatum bis zur letzten abgeschlossenen Woche. Beginnt die Historie mitten in einer Woche, wird diese Randwoche ausgeschlossen. Mehrwochenwerte beziehen sich auf zusammenhängende Fenster einschließlich inaktiver Wochen; Fenster mit unbekannten Dauern werden ausgeschlossen. Für zu kurze Historie ist der betreffende Wert `null` mit Begründung.

Diese Werte beschreiben aufgezeichnetes Training. Eine Nullwoche bedeutet nur „keine Aktivität gespeichert“; unvollständige Importe können nicht als nachgewiesene Trainingspause gelten. Historische Spitzen sind weder eine medizinische Belastbarkeitsgrenze noch eine automatische Vorgabe für einen neuen Peak.

### Fehlende und teilweise vorhandene Daten

Sensorabdeckung ist zeitgewichtet. Cycling-Power-Abdeckung verwendet ausschließlich Rad-Sessions; HF-Abdeckung alle Sportarten. Die erfasste Zeit wird pro Session auf deren Timerdauer begrenzt. Ist eine relevante Trainingsdauer unbekannt, bleibt die Abdeckungsquote `null`, statt einen unbekannten Nenner vorzutäuschen.

Powerzonen verwenden die konfigurierte aktuelle FTP, HF-Zonen die aktuelle maximale HF. Intensitätsanteile haben gemessene Sensorsekunden als Nenner und bleiben nach Power und HF getrennt: Power Z1–2/Z3/Z4–7, HF Z1–2/Z3/Z4–5. Die Gruppen sind beschreibende Zonen, keine individuell ermittelten physiologischen Schwellen.

Stunden, Distanz und Höhenmeter sind bei teilweise fehlenden Angaben bekannte Teilsummen; fehlende Sessionwerte werden in `dataQuality` gezählt. Cycling-TSS eines Zeitraums wird nur summiert, wenn jede relevante Rad-Session die vorhandene Zuverlässigkeitsprüfung erfüllt: gültige Dauer, Normalized-Power-Faktor und Power-Abdeckung innerhalb von 95–105 % der Timerdauer. Fehlende FTP, unbekannte Dauer oder unvollständige Power führen zu `null` mit Begründung. Für andere Sportarten wird keine TSS erfunden. Die aktuellen Schwellen gelten auch für historische Daten; es existiert keine FTP-Zeitreihe.

## Morgen-Check-in und Tagesampel

Beim ersten Öffnen am Tag erscheint der Morgen-Check-in, solange es für heute noch keinen gibt. **Später** schließt ihn bis zum nächsten Tag; die Startseite und der Bereich **Heute** im Coach zeigen ihn weiter als offen. Unter **Einstellungen → Coach-Verhalten** lässt sich das automatische Öffnen abschalten (`preferences.dailyCheckIn`).

Oben steht, wo der Tag im Plan liegt: Woche X von N mit Phase, Belastungs- oder Entlastungswoche, Wochenziel und Fokus, die Wochen bis zum Ziel und – mit WHOOP – Readiness und Schlaf. Danach folgen sieben Fragen zum Antippen, jeweils 1–5: Wohlbefinden (sehr schlecht – ausgezeichnet), Erholung (erschöpft – frisch), Stress (entspannt – sehr gestresst), Muskelkater (keiner – extrem), Stimmung (negativ – euphorisch), Ernährung am Vortag (zu wenig – passend – zu viel) und Alkohol am Vorabend (nein, 1–2 Getränke, mehr).

**Beschwerden** werden einmal ausführlich erfasst: Region (Fuß, Knöchel, Schienbein, Wade, Knie, Oberschenkel, Hüfte, Rücken, Schulter, Ellbogen/Hand), Seite, Schmerz 0–10, wann es wehtut (während, außerhalb der Belastung oder beides), Beginn (sofort beim Start, im Verlauf, erst danach) und die gewünschte Auswirkung (normal trainieren, anpassen, pausieren). Danach bleibt die Beschwerde aktiv, und der Check-in fragt nur noch nach dem Verlauf (besser, gleich, schlechter) und dem Schmerz heute, bis sie als ausgeheilt markiert wird. Die Region bestimmt die betroffenen Sportarten: Fuß bis Hüfte Laufen, das Knie Laufen und Radfahren, Schulter und Arm Schwimmen; der Rücken senkt die Belastung allgemein.

Die **Tagesampel** rechnet `backend/coach_wellness.py` mit festen Regeln, ohne KI:

| Stufe | Auslöser |
| --- | --- |
| Rot | Wohlbefinden sehr schlecht; eine Beschwerde mit Schmerz ab 5, die sofort bei Belastung einsetzt oder bei der du pausieren willst; drei gelbe Signale zusammen. |
| Gelb | Wohlbefinden schlecht, erschöpft, sehr hoher Stress, extremer Muskelkater, Alkohol (mehr als 1–2 Getränke), WHOOP-Readiness rot, Schmerz 3–4 oder „anpassen“. Vor einer harten Einheit zählen zusätzlich: müde, hoher Stress, starker Muskelkater, 1–2 Getränke; vor harten oder langen Einheiten auch zu wenig gegessen. |
| Grün | Keine dieser Signale. Leichte Hinweise (z. B. etwas wenig gegessen, Schmerz unter 3) erscheinen als Notiz. |

Eine schwere Beschwerde (Rot) sperrt ihre Sportarten serverseitig: Neue oder geänderte Einheiten ab heute mit einer betroffenen Sportart werden abgelehnt, bis die Beschwerde abklingt oder ausgeheilt ist. Bei Gelb oder Rot bietet der Check-in mit Plan **Woche anpassen lassen** an. Das öffnet den Coach-Chat mit der heutigen Einheit als Bezug; die KI bekommt Ampel und Beschwerden im Kontext, schlägt eine Änderungskarte vor und darf keinen Umfang nachholen. Wie jede Änderung wird sie erst mit **Übernehmen** gespeichert. Der frühere Wochen-Patch mit `trigger: "checkIn"` bleibt als Endpunkt erhalten.

## Verfügbarkeit, Templates und Planänderungen

Die Oberfläche pflegt Zeitfenster und Ausnahmen; daraus leitet der Server die Standardwoche und Tages-Overrides ab. Die Priorität lautet **Standardwoche → Wochen-Override → Tages-Override**. Wochen werden als `YYYY-Www`, Tage als `YYYY-MM-DD` gespeichert. `available: false` oder ein Tages-`action: "skip"` ergibt null verfügbare Minuten. Overrides ändern die Standardwerte nicht. Die Verfügbarkeit ist ein Zeitrahmen, keine Pflicht: Im Profil legst du zusätzlich fest, an wie vielen Tagen pro Woche du trainieren willst, ob gerade Winter (Rolle), Sommer (draußen) oder gemischt ist, und wie lange eine normale Radeinheit auf der Rolle bzw. draußen mindestens dauert (bei „gemischt“ gilt der kürzere Wert). Regenerationsfahrten sind ausgenommen. TrainHub lehnt AI-Wochen ab, die mehr Trainingstage oder kürzere Radeinheiten enthalten; bestehende, unveränderte Einheiten zählen nicht als Verstoß. Wochen-Overrides werden für höchstens 104 Wochen, Tages-Overrides für 366 Tage und Check-ins für 90 Datumswerte aufbewahrt.

Der Katalog umfasst Regeneration, kurze/lange Grundlage, Grundlage mit Sprints, Tempo, Sweetspot, Schwelle, VO₂-Intervalle, VO₂-Mikrointervalle in Sätzen (z. B. 3×13×30/15 oder 3×10×40/20, jeder Satz ein Wiederholungsblock auf dem Gerät) und Sprintintervalle (SIT, z. B. 6×30 s mit 4 min Pause) am Rad sowie lockere, Schwellen- und lange Läufe, allgemeines Krafttraining und Ruhetage. Harte Radeinheiten können eine Trittfrequenz bekommen, die im Namen jedes harten Abschnitts steht (z. B. „Hart · 100 U/min“); das Wattziel bleibt das Ziel des Schritts. Einheiten heißen nach ihrer Struktur, etwa „VO2-Mikrointervalle Rad 3×13×30/15“. Jede Einheit bekommt einen festen Verpflegungshinweis nach Art und Dauer: bei HIT vorher und währenddessen Kohlenhydrate, bei intensiven Einheiten Kohlenhydrate während der Einheit, bei kurzen lockeren Einheiten optional nur Wasser und danach Protein, ab 90 min etwas, ab 150 min regelmäßig und ab 6 h zusätzlich feste Nahrung, Salz und geplante Nachfüllstopps. Der Hinweis steht in der Wochenansicht, ist im Workout-Editor änderbar (Feld `notes`, höchstens 250 Byte) und erscheint auf der Garmin als Beschreibung des Workouts (`wkt_description`). Er ist eine allgemeine Orientierung, keine Ernährungsberatung. Mikrointervalle zählen als VO₂max-Einheit, SIT als Qualitätseinheit (im Wiedereinstieg nicht erlaubt), Grundlage mit Sprints als lockere Einheit; für den Anteil lockeren Trainings zählt nur die reine Belastungszeit als hart. Die AI wählt Template und Parameter. TrainHub prüft deren Grenzen und erzeugt Aufwärmen, Belastung, Erholung und Abwärmen. Intervall-Einheiten am Rad können eine Gesamtdauer (`durationMin`) bekommen; die zusätzliche Zeit wird als lockere Grundlage (65 % FTP) vor und nach den Intervallen gefahren, z. B. 2 h mit 5×5 min. Radeinheiten dauern bis 15 h (900 min), etwa für Ultra-Ziele wie das NorthCape 4000. Radziele basieren auf FTP. Laufziele sind Pace-Bereiche aus der Schwellenpace (Anzeige z. B. „4:35–4:50 /km“, Garmin-Export als Geschwindigkeitsbereich); die Intensität bleibt ein Anteil der max. HF und wird linear umgerechnet (89 % HFmax = Schwellenpace). Ohne Schwellenpace oder mit HF als Primärmetrik gelten HF-Ziele, ohne Schwelle bleiben Ziele offen. Dauer und geplante Cycling-TSS werden deterministisch berechnet. Die geplante TSS ist eine Schätzung aus den Zielwerten und bleibt von tatsächlich absolvierter Belastung getrennt.

Rad- und Laufworkouts werden nach Bestätigung in den bestehenden Kalender übernommen und können dessen Editor/FIT-Export nutzen. Krafttraining und Ruhetage werden in der Coach-Woche gespeichert und angezeigt; sie erzeugen derzeit kein Garmin-Workout und keinen eigenen Eintrag im bestehenden Workout-Kalender. Krafttraining verlangt `gymAvailability: true`.

Vorhandene eigene Kalenderworkouts zählen als feste Verpflichtungen zur verfügbaren Zeit. Bereits bearbeitete Coach-Workouts werden beim Laden mit dem Kalender abgeglichen. Rad-/Laufworkouts können fixiert werden (in der Oberfläche **Behalten**); ein AI-Patch darf sie weder verschieben, ersetzen noch löschen. Auch bestehende nicht zum Coach gehörende Kalenderworkouts werden durch die Planung nicht überschrieben.

Ein Wochen-Patch enthält ausschließlich `add`, `replace` oder `remove` für einzelne Session-IDs sowie aktualisierte Zielstunden und Fokus. Unbekannte oder doppelte IDs, Änderungen fixierter oder vergangener Einheiten, falsche Kalenderwochen, Zeitüberschreitungen und unplausible Abweichungen zwischen Zielstunden und gerenderter Dauer werden abgelehnt. Bei den Wochenstunden zählen auch vorhandene Kalendereinheiten mit. Die zulässige Rundungsabweichung ist ungefähr 15 Minuten.

Die API speichert zunächst einen Vorschlag mit `before`, `after`, `hinweise` und der strukturierten Entscheidung. **Verwerfen** ändert den Plan nicht. Erst die ausdrückliche Übernahme mit `{"confirm":true}` (bei Blockvorschlägen `{"confirm":true,"optionId":"…"}`) schreibt den bestätigten Plan und die betroffenen Workouts in einer Transaktion. Ein veränderter Ausgangszustand (Profil, Planung, Trainings-/Kalenderstand oder Provider-Einstellungen) macht den Vorschlag ungültig. Vorschläge verfallen nach 24 Stunden; Wiederholung einer erfolgreichen Bestätigung erzeugt keine doppelten Workouts.

## Plan-Eingaben: Sportarten, Events, Zeitfenster

Grundlage für den Ablauf aus [`docs/coach-umsetzung.md`](docs/coach-umsetzung.md) (M1). Onboarding und Einstellungen bearbeiten diese Felder.

- **Sportarten und Metriken:** `sports` (regelmäßige Sportarten), `metrics` (Primärmetrik je Sportart, Vorgabe Rad `power`, Laufen `pace`) und `thresholds` mit Herkunft (`athlete`, `calculated` oder `test` für „Testen lassen“). FTP und max. HF bleiben in den Einstellungen; die Schwellenpace steht unter `thresholds.run.paceSecPerKm`. `GET /api/coach/thresholds` schlägt eine Schwellenpace aus den Bestzeiten des letzten Jahres vor (5 km, 10 km oder Halbmarathon, hochgerechnet auf eine Stunde nach Riegel).
- **Events:** `events[]` mit Titel, Sportart, Untertyp, Start/Ende, Uhrzeit, Ort, Priorität A/B/C, Umgang (`miniTaper`/`trainThrough` bei B, `replaceHard`/`easy` bei C), Distanz bis 10.000 km, Zielzeit bis 60 Tage und Höhenmeter bis 100.000 m. Die Beschreibung geht als `athleteWish` an die AI. Ein früheres Zieldatum mit Namen wird zum A-Event. In geplanten Wochen stehen Events als Einträge `kind: "event"` unter `events`, nicht als Workout. Die Wochenprüfung lehnt neue oder geänderte Einheiten ab, die an einem Eventtag liegen, vor einem B-Event mit Mini-Taper hart sind (Vortag) oder die Qualitätsgrenze der 3 Tage davor überschreiten (eine Einheit bis 75 min), oder die nach dem Event nicht locker sind (B 2 Tage, C mit `replaceHard` 1 Tag). Ein C-Event mit `replaceHard` ersetzt eine Qualitätseinheit seiner Woche.
- **Zeitfenster:** `availability.windows[]` je Wochentag (`available`/`unavailable`, ganzer Tag oder von–bis, Sportarten mit Optionen wie Rolle/draußen oder Equipment, optional Gruppentraining) mit `maxWeeklyHours` (die zeitliche Obergrenze, keine Empfehlung), `restDays` (bevorzugte Ruhetage, Alternativen) und `longDays` (mögliche Tage für die lange Einheit); `restDay`/`longDay` halten weiter den ersten Tag für ältere Clients. `noConsecutiveRestDays` („Zwei Ruhetage hintereinander: Vermeiden“) gilt auch über den Wochenwechsel von Sonntag auf Montag (der Coach sieht dafür `trainingRules.neighbourDays`). Die Verfügbarkeit hat Vorrang: Haben zwei Tage hintereinander (auch So/Mo) keine Zeit, lässt sich die Regel nicht setzen, und neue Fenster mit einer solchen Lücke heben sie auf. Sobald Fenster gespeichert sind, ergeben sich daraus `defaultAvailability` (Minuten pro Tag), das Wochenmaximum (ohne eigenen Wert die Summe der Fenster) sowie Ruhetag und langer Tag. `availability.exceptions[]` (von–bis, `unavailable` oder `available` mit Minuten pro Tag, Notiz) wirken wie Tages-Overrides; ein ausdrücklicher Tages-Override geht vor.
- **Onboarding:** `background` (B1: `type` wie Radfahrer/Läufer/Triathlon, `weeklyHours`, `intervals` je Sportart, `source` `calculated` bei „Stimmt so“ oder `athlete`) und `onboarding.completed` (erledigte Schritte, `created` nach der Planerstellung). Der Wizard (`CoachOnboarding.jsx`) speichert jeden Schritt sofort und setzt beim ersten offenen Schritt fort; „Heute“ und „Plan“ zeigen ohne Plan die Karte „Lass uns deinen Plan bauen“. Die Plansportarten (B3) stehen wie bisher in `goal.sports` (Rad, Laufen) und `preferences.gymAvailability` (Kraft); ein A-Event wird zusätzlich als `goal` (Name, Datum) gespeichert, damit die bisherigen Ansichten es zeigen.
- **Planeinstellungen:** `plan.settings` mit `startDate`, `endDate` (ohne Obergrenze), `replanMode` (`afterReview`, `sunday`, `manual`) und `createdAt`.
- **Tests:** Bei „Testen lassen“ (`thresholds.ride.source` bzw. `thresholds.run.source` = `test`) muss die erste Planwoche den **FTP-Test Rad** (20 min gleichmäßig maximal, FTP ≈ 95 % der Durchschnittsleistung) bzw. den **30-min-Lauftest** (Schwellenpace ≈ Durchschnittspace der letzten 20 min) enthalten. Beide dauern fest 55 min, der Testteil hat kein Ziel. Tests zählen als harte Einheit (Eventregeln), aber nicht gegen die Qualitätsgrenzen der Blöcke und nicht gegen die Mindestdauer von Radeinheiten.
- **Verbrauch:** Jede Provider-Antwort speichert ihre Tokens (Eingabe, Ausgabe, davon gecacht) mit Art und Modell, auch wenn die Antwort danach abgelehnt wird. `GET /api/coach/usage` zeigt den Monat mit Kosten für Modelle mit bekanntem Preis (gpt-6-astra, gpt-6.1-sol, gpt-6-luna); gecachte Eingabe zählt zum vollen Preis, die Kosten sind also eine Obergrenze.

## Plan erstellen und Nachplanen

Ablauf aus [`docs/coach-umsetzung.md`](docs/coach-umsetzung.md) (M2, Backend). Das Onboarding (M3) erstellt den Plan, der Bereich Plan (M4) zeigt ihn und plant nach.

- **Plan erstellen** (`POST /api/coach/plan/create`): braucht gespeicherte Planeinstellungen, Verfügbarkeiten und einen Provider. Der Server startet einen Hintergrund-Job und antwortet mit `202` und `job`; der Client fragt `GET /api/coach/plan/create/<job>` ab. Schritte: **Phasen festlegen** (ein AI-Aufruf für alle Wochen bis zum Planende) und **Woche 1–3 planen** (je ein AI-Aufruf). Die Phasen werden als Blöcke mit `source: "plan"` und `purpose` gespeichert, dazu `plan.frame` (Status, Zeitraum, Begründung, Hinweise). Die Wochen werden ohne Vorschlag direkt übernommen und stehen im Kalender. Verletzt die Antwort für eine Woche eine Regel (Blockregeln, eigene Stunden, Ruhetage …), bekommt der Coach sie einmal mit dem Grund zurück (`systemNote.rejectedChange`); erst der zweite Fehler bricht ab („Woche 10: Der Coach hat zweimal eine Regel verfehlt (…)“). Auch nach einem Abbruch lädt der Coach Plan und Kalender neu, damit die schon gespeicherten Wochen sichtbar sind. Jeder Schritt wird sofort gespeichert. Schlägt einer fehl (Provider, Prüfregel), endet der Job mit `status: "failed"` und `error`; ein erneuter Aufruf setzt beim fehlenden Schritt fort. Die Eingaben des Onboardings sind zu diesem Zeitpunkt längst gespeichert (jeder Schritt speichert beim Weiter): „Bereit“ bietet **Speichern & später erstellen**, und nach einem Fehler lässt sich der Dialog schließen („Später erneut versuchen“); beim nächsten Öffnen geht es bei „Bereit“ weiter. Generierungen haben 180 s Zeit (mit Reasoning 300 s); eine Zeitüberschreitung meldet „Der AI-Provider hat nicht rechtzeitig geantwortet“. Ein Job eines neu gestarteten Servers erscheint als unterbrochen. Es läuft immer nur ein Job (sonst `409` mit dem laufenden Job). **Stoppen** (`POST /api/coach/plan/jobs/<job>/stop`) beendet einen laufenden Job sofort mit `status: "stopped"`: fertige Schritte bleiben gespeichert, die Antwort des laufenden Schritts wird beim Eintreffen verworfen, und ein neuer Job kann gleich starten. Der Coach zeigt den Fortschritt laufender Jobs oben unter den Reitern und im Plan, jeweils mit „Stoppen“.
- **Rhythmus bis zum Event:** Vor jedem A-Event zählt der Server Zyklen aus drei Belastungs- und einer Entlastungswoche rückwärts vom Taper (`taperWeeks`, ohne Wahl 2 Wochen). Übrige Wochen gehen an den Anfang: eine Woche macht den ersten Zyklus 4:1, zwei die ersten beiden (in kurzen Plänen zwei 2:1-Zyklen), drei einen zusätzlichen 2:1-Zyklus. Der Peak ist die letzte Belastungswoche vor der letzten Entlastung, beim 2-Wochen-Taper also die dritte Woche vor dem Event. Die KI bekommt die Zyklen als `periodization.cycles`; danach richtet der Server die Phasen der KI auf ganze Zyklen aus (Phasengrenzen wandern zum nächsten Zyklusende). Rhythmus und Zielstunden setzt danach immer der Server (`shape_volume` in `coach_plan.py`), auch nach Änderungen von Hand: Der Rhythmus läuft über Blockgrenzen hinweg, ein hinzugefügter oder verlängerter Block bekommt keinen eigenen 2:1-Rhythmus mehr.
- **Wochenstunden:** Maßstab ist die Belastbarkeit, die verfügbare Zeit begrenzt nur. Die erste Belastungswoche beginnt bei der Trainingsbasis (`background.weeklyHours`, sonst der Schnitt der letzten 12 Wochen, sonst der Wunschumfang), die Belastungswochen steigen gleichmäßig bis zur empfohlenen Peak-Woche (siehe **Empfohlene Wochenstunden**), höchstens 5 % über die Belastungswoche davor (`periodization.maxRisePerLoadWeek`), sodass der Peak erst mit der letzten Belastungswoche vor dem Taper kommt und nur kurz gehalten wird. Nach einer Entlastung setzt der Zyklus beim Niveau der letzten Belastungswoche wieder an. Entlastungen haben 60 % der letzten Belastungswoche, jede Taperwoche 80 % der Woche davor (höchstens 70 % des Wunschumfangs), Übergangswochen die Hälfte. Jede Woche bleibt in ihrer verfügbaren Zeit (Viertelstunden), eine kurze Woche (Urlaub) unterbricht den Anstieg nicht. Start und Peak werden beim Erstellen des Plans in `plan.volume` (`baseHours`, `peakHours`) festgehalten.
- **Eigene Wochen:** Im Diagramm „Wochenstunden bis zum Ziel“ öffnet ein Tipp auf eine Woche einen Editor: **Belastung** oder **Erholung** (nur in Phasen mit Rhythmus) und eigene Stunden, der Vorschlag steht daneben; „Auf Vorschlag zurücksetzen“ nimmt die eigene Wahl zurück. **Umfang aller Wochen** (70–130 % in 5-%-Schritten) skaliert alle Wochen ohne eigene Stunden. Gespeichert in `plan.volume` (`scale`, `weeks: {"2026-W48": {"kind", "hours"}}`). Der Rhythmus der übrigen Wochen bleibt, wie er ist (ein 4:1-Zyklus entsteht also, wenn der Athlet Woche 4 auf Belastung und Woche 5 auf Erholung stellt); die Stunden rechnen ab der Änderung weiter. Eigene Stunden gelten nur für ihre Woche, sind für den Coach bindend (±30 min; verfehlt er sie, bekommt er einen zweiten Versuch, sonst schlägt das Ausarbeiten fehl) und dürfen die verfügbare Zeit nicht überschreiten. Noch nicht ausgearbeitete Wochen folgen sofort, ausgearbeitete werden für „Plan anpassen“ vorgemerkt.
- **Empfohlene Wochenstunden:** Für das nächste A-Event fragt `POST /api/coach/volume/recommendation` die KI nach Minimum, Durchschnitts- und Peak-Woche mit kurzer Begründung. Sie bekommt Eventart, Distanz, Höhenmeter, Ziel (Ankommen oder Zielzeit), Wochen bis zum Event, die Trainingsbasis und den Schnitt der letzten 12 Wochen. Leitplanken: Minimum ≤ Durchschnitt ≤ Peak in halben Stunden, der Peak höchstens 60 % über der Trainingsbasis. Die Antwort bleibt gespeichert (`plan.volumeRecommendation`), bis sich Event, Ziel oder Trainingsbasis ändern; bis dahin und ohne KI gelten feste Regeln (Minimum je Eventart, z. B. Gran Fondo 6 h, mit Zielzeit 25 % mehr im Schnitt, nie unter der Trainingsbasis, Peak 25 % über dem Schnitt). Die Verfügbarkeiten zeigen Minimum, Ø und stärkste Woche neben der verfügbaren Zeit und dem bisherigen Schnitt; das Onboarding fragt die KI dafür einmal pro Event an.
- **Prüfung der Phasen:** Blockregeln je Phase, lückenlos bis zur Woche des Planendes, Zielstunden höchstens wie die verfügbare Zeit der Woche (Ausnahmen eingerechnet). Jedes A-Event beendet einen Zyklus: Seine Woche ist die letzte Woche einer Phase Wettkampfspezifisch oder Taper. Im Zyklus gilt Übergang (nur nach einem Event) → Wiedereinstieg → Grundlage → Aufbau/VO2max/Schwelle → Wettkampfspezifisch → Taper. Nach dem letzten A-Event folgen Übergang und Grundlage bis zum Planende; ohne A-Event gibt es keine Phase Wettkampfspezifisch oder Taper.
- **Planstart unter der Woche:** Die erste Planwoche ist die Kalenderwoche des Starts; Tage davor bleiben frei.
- **Gruppentraining:** Zeitfenster mit `group` werden beim Ausarbeiten einer Woche als feste, gesperrte Kalender-Workouts „Gruppentraining“ eingetragen (Dauer des Fensters, Intensität und Notiz im Hinweis) und zählen zu den Stunden. Sie entfallen an Eventtagen und wenn eine Ausnahme weniger Zeit lässt. Kalender-Workouts gibt es dafür nur für Rad, Laufen und Schwimmen.
- **Wochenrückblick** (`PUT /api/coach/weeks/<week>/review`): `missedSessions`, Anstrengung `effort` 1–5, Gründe `reasons` (`asPlanned`, `lackOfTime`, `sick`, `injured`, `tired`, `travel`) und `note`. Im Modus „Nach meinem Wochenrückblick“ startet das Absenden das Nachplanen; die Antwort enthält dann `job`.
- **Nachplanen** (`POST /api/coach/plan/advance`, `{"trigger":"auto"|"manual"}`): arbeitet die fälligen vorgemerkten Wochen nacheinander aus, damit wieder so viele Wochen fertig sind, wie `horizonWeeks` vorgibt (Standard 3, ohne Obergrenze), und übernimmt sie direkt; nur die erste reagiert auf den Rückblick. `auto` plant nur, wenn es laut Modus fällig ist: `afterReview` nach dem Rückblick, ohne ihn ab Montag 06:00; `sunday` ab Sonntag 18:00; `manual` nie automatisch. Einen Server-Scheduler gibt es nicht, der Client ruft `auto` beim Öffnen auf. `GET /api/coach/plan/advance` sagt, ob eine Woche fällig ist (`week`) und welche ein Knopfdruck planen würde (`nextManualWeek`). Rückblick und Check-ins gehen als Kontext mit. War die Woche stark abweichend (krank, verletzt oder weniger als 60 % der geplanten Stunden), entsteht zusätzlich ein Vorschlag `kind: "weeks"` für die schon ausgearbeiteten Wochen danach; er wird wie andere Vorschläge bestätigt oder verworfen.
- **Plan beenden** (`POST /api/coach/plan/reset`): Spätere Wochen und ab heute geplante Einheiten (gesperrte Coach-Einheiten bleiben) werden mit ihren Kalender-Workouts entfernt, die laufende Phase endet am Sonntag dieser Woche, spätere Phasen entfallen, `plan.frame.status` wird `ended`. Vergangenes bleibt erhalten.

## Plan, Heute und Coach-Chat

Ablauf aus [`docs/coach-umsetzung.md`](docs/coach-umsetzung.md) (M4).

- **Plan** (`CoachPlan.jsx`, Daten aus `GET /api/coach/plan/weeks`): Countdown bis zum nächsten A-Event, Phasenleiste mit Heute und Events (A groß, B/C klein; Tippen zeigt den Zweck der Phase), die ausgearbeiteten Wochen mit Tagen und Einheiten, vorgemerkte Wochen mit Phase, Zielstunden und dem Termin des Nachplanens („wird am So., 01.11. ausgearbeitet“; im Modus „Nur auf Knopfdruck“ mit „Nächste Woche planen“) sowie der **Verlauf** (geplant gegen absolviert, Rückblick, Check-ins). **Phasen ändern** oben rechts öffnet den Block-Editor für die Schwerpunkte (Grundlage, VO2max, Schwelle …) (verschieben, verlängern, verkürzen, hinzufügen, entfernen, Taper 1–3 Wochen). Darunter zeigt ein Diagramm die Zielstunden jeder Woche bis zum Ziel; ein Tipp auf eine Woche legt Belastung/Erholung und eigene Stunden fest, „Umfang aller Wochen“ skaliert alle Wochen (siehe **Eigene Wochen**). Danach folgt die Einstellung, wie viele Wochen konkret ausgearbeitet werden. Eine Einheit öffnet ein Detail mit Ablauf, Zielen, „Warum diese Einheit“, Verpflegung, Editor/Garmin-Export und den Aktionen **Verschieben**, **Tauschen**, **Auslassen** (über den Chat) und **Behalten** (fixieren). **Woche anpassen** öffnet den Chat mit der Woche als Bezug. Der **Wochenrückblick** fragt Anstrengung 1–5, Gründe und ausgelassene Einheiten ab und startet je nach Modus das Nachplanen. Ein Mehrwochen-Vorschlag nach starker Abweichung oder nach geänderten Einstellungen erscheint im Plan als Änderungskarte. Beim Öffnen des Coachs ruft das Frontend `POST /api/coach/plan/advance` mit `auto` auf.
- **Heute** zeigt mit Plan „Woche 3 von 13 · Grundlage“, bei Gelb oder Rot die Schnellbuttons **Kürzer**, **Lockerer**, **Ruhetag**, **Auf morgen** und **Coach fragen** (sie schicken eine vorbereitete Nachricht mit der heutigen Einheit als Bezug in den Chat), den Ausblick auf die nächsten 3 Tage und Hinweiskarten: Wochenrückblick offen (sonntags, für die Vorwoche bis Dienstag), neu geplante Woche (3 Tage lang) und Events in den nächsten 7 Tagen. `GET /api/coach/today` liefert dafür `period.planWeek`, `outlook` und `hints`.
- **Coach-Chat** (`CoachChat.jsx`, Button „Coach fragen“ in Heute und Plan; auf dem Handy als Vollbild): Verlauf, Bezug-Chip (entfernbar), Schnellantworten, Ladezustand; ohne Provider ist das Eingabefeld gesperrt. Die KI bekommt Snapshot, Phasen, die ausgearbeiteten Wochen ab dieser Woche mit Verfügbarkeit, festen Einheiten, Blockregeln und Events, die letzten 6 Planwochen mit absolvierten Stunden, Events, Verfügbarkeiten, Schwellenwerte, Ampel und Beschwerden sowie die letzten 20 Nachrichten. Die Nachricht geht als Daten (`message.source: athlete`) mit, nie als Anweisung. Die Antwort ist `{reply, change}`: `change` enthält Patches für ausgearbeitete Wochen und/oder Einstellungen (Ausnahme, neues Zeitfenster, Wochenmaximum, Event, FTP oder Schwellenpace). Jeder Patch läuft durch dieselbe Wochenprüfung wie bisher, Einstellungen durch die Prüfung der Editoren. Lehnt der Server die Änderung ab, steht die Prüfmeldung als Systemhinweis im Chat und der Coach bekommt sie für eine Alternative (höchstens ein zweiter Versuch). Scheitert auch dieser, bleibt der Plan unverändert und ein Hinweis sagt das. Eine gültige Änderung wird als Vorschlag `kind: "chat"` gespeichert und erscheint als **Änderungskarte** (betroffene Tage, Vorher/Nachher, neue Wochenstunden, Einstellungen). Erst **Übernehmen** ändert Plan, Kalender und Einstellungen, **Verwerfen** nichts; eine neue Karte verwirft die offene. Eine Nachricht wird erst mit ihrer Antwort gespeichert. **Neuer Chat** blendet den Verlauf aus und verwirft eine offene Karte; „Plan beenden“ in den Einstellungen tut das auch.

## Provider, Übertragung und Schlüssel

Der Provider bekommt kompaktes JSON ohne vollständige Sensorstreams, GPS-Tracks, Original-FIT-Dateien oder API-Key im Planungskontext. Die lokalen Caches können bei Bedarf aus vorhandenen Aufzeichnungen aufgebaut werden; diese Rohdaten verlassen dabei TrainHub nicht. Ziele, Notizen und subjektive Check-ins gehören zum Kontext und werden bei entsprechenden Planungsanfragen an den gewählten Provider übertragen.

Ein Trainingsblock-Vorschlag erhält den Snapshot, Startdatum, Modus, Ausgangslage bzw. die eigene Wahl, den Blockkatalog mit Regeln und die letzten drei Blöcke mit Wochenverlauf, Summen, Check-in-Mitteln und deiner Einschätzung; ältere Check-ins und Overrides werden aus diesem Provider-Kontext gekürzt. Eine neue konkrete Woche erhält nur den zugehörigen Block (Typ, Nebenschwerpunkt, Woche X von N, Regeln) und dessen Blockwoche, aktuelle Verfügbarkeit, kompakte Plan-/Template-Informationen, die bisher geplanten Wochen desselben Blocks (`blockHistory`, damit Einheiten entlang ihrer Steigerungsketten weiterlaufen), jüngstes Training, dein Trainingsmuster der letzten 8 vollständigen Wochen (`recentPattern`: Einheiten und Trainingstage pro Woche, typische Dauer) und deine Trainingsvorgaben (`trainingRules`). Ein Patch verwendet den bestehenden kompakten Wochenplan und gegebenenfalls einen abgeschlossenen Wochenrückblick, ohne erneut die vollständige Historie zu schicken. Der Chatverlauf wird lokal gespeichert; an den Provider gehen bei einer Chat-Nachricht nur die letzten 20 sichtbaren Nachrichten.

Der OpenAI-Adapter verwendet `POST /v1/responses`, `store: false` und `text.format` mit `type: "json_schema"` und `strict: true`, entsprechend der [offiziellen Dokumentation zu Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Das Backend validiert jede Antwort zusätzlich lokal gegen das JSON-Schema und anschließend gegen die fachlichen Regeln. Unvollständige Antworten, Ablehnungen, unbekannte Felder und ungültige Zahlen verändern keinen Plan. Requests haben ein 60-Sekunden-Zeitlimit, Antworten eine Grenze von 1 MiB; es gibt keine automatischen kostenpflichtigen Wiederholungen. `store: false` ist die verwendete API-Einstellung und kein Versprechen, dass beim Provider keinerlei Daten verarbeitet oder aufbewahrt werden.

Der Browser übermittelt den eingegebenen API-Key einmal ans Backend und leert das Eingabefeld. TrainHub legt ihn nicht in Local Storage oder Session Storage ab und liefert ihn nach dem Speichern nicht zurück. Statusantworten enthalten nur Provider, Modell, `configured`, `keyLast4`, `encryptionConfigured` sowie Herkunft (`encryptionKeySource`: `environment`, `file`, `created`, `invalid` oder `unavailable`) und Pfad (`encryptionKeyFile`) des Serverschlüssels, nie den Schlüssel selbst. Der Datenbankwert ist mit Fernet verschlüsselt; nur der Backend-Prozess entschlüsselt ihn für Provider-Anfragen. Provider-Fehler werden ohne fremde Fehlertexte oder Secrets zurückgegeben.

Den Server-Schlüssel dauerhaft und getrennt von Datenbank-Backups sichern. Ein Datenbank-Backup allein reicht nicht zur Entschlüsselung des gespeicherten Provider-Keys. Geht der Server-Schlüssel verloren, muss ein neuer eingerichtet und der Provider-Key erneut hinterlegt werden; Trainingsdaten und Pläne benötigen ihn nicht.

Es gibt keine automatische Schlüsselrotation oder Mehrfachschlüsselverwaltung. Für eine manuelle Rotation zuerst Datenbank und bisherigen Schlüssel getrennt sichern, die Schlüsseldatei entfernen (TrainHub legt beim nächsten Start eine neue an) oder einen neuen Wert für `TRAINHUB_AI_ENCRYPTION_KEY` setzen, das Backend neu starten und den API-Key im Providerformular erneut speichern. Dadurch wird er mit dem neuen Schlüssel verschlüsselt. Alte Sicherungen bleiben an den alten Schlüssel gebunden. Das Entfernen eines gespeicherten Keys in TrainHub widerruft ihn nicht beim Provider.

TrainHub verwendet weiterhin einen lokalen Athleten ohne Benutzeranmeldung. Die Coach-Endpunkte begrenzen Host/Origin, verlangen JSON für schreibende Anfragen und setzen `Cache-Control: no-store`. Weitere erlaubte Origins lassen sich über `TRAINHUB_COACH_ORIGINS` kommagetrennt ohne Leerzeichen konfigurieren. Diese Prüfung ersetzt keine Authentifizierung. Ein öffentlicher oder geteilter Betrieb benötigt zusätzlich Benutzeranmeldung, Autorisierung, TLS und eine passende Bereitstellung der Servergeheimnisse; das aktuelle lokale Modell ist dafür nicht ausgelegt.

## API-Übersicht

Alle schreibenden JSON-Anfragen verwenden `Content-Type: application/json`. Die Coach-Anfragegröße ist auf 64 KiB begrenzt. `timezone` ist bei Snapshot, Planung und Rückblick optional; ohne Angabe gilt `Europe/Berlin`.

| Methode | Endpoint | Inhalt |
| --- | --- | --- |
| GET | `/api/athlete-snapshot` | Berechneter Snapshot und getrennte Athletenangaben. |
| GET / PUT | `/api/athlete-profile` | Ziel, Sportarten, Metriken, Schwellenwerte, Verfügbarkeit (mit Zeitfenstern und Ausnahmen), Präferenzen, Einschränkungen, aktuelle Selbsteinschätzung. PUT ersetzt die angegebenen vollständigen Teilbereiche; bei `goal`, `availability`, `preferences`, `metrics` und `thresholds` behalten fehlende Felder ihren gespeicherten Wert. |
| PUT | `/api/coach/weeks/<week>/missed` | `{"missedSessions":["id"]}` speichert den Wochenrückblick ohne neue Planung; die IDs gehören zu dieser Woche. |
| PUT | `/api/coach/weekly-overrides/<week>` | `{"overrides":{"thu":{"available":false},"sat":{"maxMinutes":300,"preferLong":true}},"note":"Reisewoche"}`. |
| PUT | `/api/coach/daily-overrides/<date>` | Zum Beispiel `{"maxMinutes":45,"action":"reduce","note":"Wenig Zeit"}`. |
| GET / POST | `/api/coach/check-ins` | GET: Check-ins und Beschwerden eines Zeitraums (`from`, `to`, Standard die letzten 28 Tage). POST: Morgen-Check-in mit `date`, `wellbeing`, `recovery`, `stress`, `soreness`, `mood`, `nutrition` (je 1–5), `alcohol` (0–2), `notes`, `newInjury` (`region`, `side`, `pain` 0–10, `timing`, `onset`, `impact`) und `injuryUpdates` (`id`, `pain`, `trend`, `healed`); Antwort ist die Tagesansicht. Der frühere Check-in mit `fatigue`, `motivation`, `stress`, `sleepQuality`, `soreness` bleibt möglich. |
| GET | `/api/coach/today` | Tagesansicht (`date` optional): Check-in, Tagesampel, aktive Beschwerden, Einheiten des Tages, Phase und Planwoche (`period`), WHOOP, ob die Woche geplant ist, Ausblick (`outlook`) und Hinweise (`hints`). |
| PUT | `/api/coach/injuries/<id>` | `{"status":"healed"}` markiert eine Beschwerde als ausgeheilt. |
| GET / PUT / DELETE | `/api/ai-provider` | Status lesen, `{"provider":"openai","model":"gpt-4.1-mini","reasoningEffort":null,"apiKey":"…"}` speichern (`reasoningEffort`: `null` oder `none`, `minimal`, `low`, `medium`, `high`, `xhigh`) oder gespeicherten Key entfernen. Beim Modellwechsel kann `apiKey` entfallen. |
| POST | `/api/ai-provider/test` | `{}`; Zugang und Modell prüfen. |
| GET / POST | `/api/coach/events` | Events lesen bzw. anlegen (`title`, `sport`, `startDate`, `priority` Pflicht, Rest optional); POST antwortet mit `event` und der Liste. |
| PUT / DELETE | `/api/coach/events/<id>` | Event ersetzen oder löschen. |
| GET | `/api/coach/thresholds` | FTP, max. HF, gespeicherte Schwellenpace mit Herkunft und berechneter Vorschlag (`run.calculated`). |
| POST | `/api/coach/plan/create` | `{}`; startet die Planerstellung bzw. setzt sie fort (`202` mit `job`). |
| GET | `/api/coach/plan/create/<job>`, `/api/coach/plan/advance/<job>`, `/api/coach/plan/adapt/<job>` | Job mit `status` (`running`, `done`, `failed`, `stopped`), `steps[]`, `error` und `result`. |
| POST | `/api/coach/plan/jobs/<job>/stop` | Stoppt einen laufenden Job; fertige Schritte bleiben, der laufende und offene Schritte werden `stopped`. Ein beendeter Job bleibt, wie er ist. |
| POST | `/api/coach/plan/adapt` | `{"changes":["availability","events","thresholds","sports","period"],"later":false}`; startet das Anpassen (`202` mit `job`, Ergebnis mit `frameChanged`, `proposalId`, `changedWeeks`, `rejectedAdjustments`). Mit `"later":true` nur als Hinweis `plan.adapt` speichern. |
| GET / POST | `/api/coach/plan/advance` | Fälligkeit lesen bzw. `{"trigger":"auto"|"manual"}` nächste Woche ausarbeiten. |
| PUT | `/api/coach/weeks/<week>/review` | `{"missedSessions":[],"effort":3,"reasons":["lackOfTime"],"note":""}`. |
| POST | `/api/coach/plan/reset` | `{}`; beendet den Plan, Vergangenes bleibt; blendet den Chat aus. |
| GET | `/api/coach/plan/weeks` | Planwochen mit Phase, Zielstunden, ausgearbeiteter Woche (`plan`), Events, absolvierten Stunden und `replanDate`, für den Wochen-Editor `kind`, `defaultKind`, `suggestedHours`, `athleteKind`, `athleteHours` und `maxHours`; dazu Phasen, Events im Plan, `nextManualWeek`, `adapt` (offener Hinweis nach „Später“) und `volume` (`scale`, `baseHours`, `peakHours`). |
| GET / POST / DELETE | `/api/coach/chat` | Verlauf mit Änderungskarten; POST `{"message":"…","ref":{"kind":"session"|"week","week","sessionId","label"}}` (ref optional) antwortet mit dem Verlauf; DELETE startet einen neuen Chat. |
| GET | `/api/coach/proposals/<id>` | Ein Vorschlag mit `status` (`pending`, `confirmed`, `discarded`, `expired`). |
| GET | `/api/coach/onboarding` | Vorbefüllung fürs Onboarding (`source: calculated`): Sportarten der letzten 90 Tage, Hauptsportart und Ø Stunden pro Woche der letzten 6 Wochen, stärkste 4-Wochen-Phase, je Sportart die letzte Intervalleinheit der letzten 21 Tage (mindestens 10 min ≥ 90 % FTP bzw. ≥ 80 % max. HF). |
| GET / PUT | `/api/coach/plan/settings` | `{"startDate","endDate","replanMode"}`, optional `horizonWeeks` (Wochen mit konkreten Einheiten, Standard 3) und `taperWeeks` (1–3, Taper vor jedem A-Event; `null` = Coach entscheidet); `createdAt` setzt der Server beim ersten Speichern. Ein laufender Plan behält seinen Start. |
| PUT | `/api/coach/plan/phases` | `{"phases":[{"id","blockType","weeks"}],"taperWeeks"}`: eigene Blockliste nach festen Regeln, ohne AI. Alle Planwochen brauchen genau einen Block, vergangene Wochen bleiben, der Block vor einem A-Event endet in dessen Woche. Rhythmus und Stunden kommen danach für den ganzen Plan aus der Umfangskurve (3:1 über Blockgrenzen, eigene Wochen bleiben). Ausgearbeitete Wochen mit geänderter Gliederung landen als `adapt` mit `phases` im Plan („Plan anpassen“). |
| PUT | `/api/coach/plan/volume` | `{"scale":1.1,"weeks":[{"week","kind","hours"}]}`: Umfang aller Wochen und eigene Wochen (Belastung/Erholung, Stunden), ohne AI. Vergangene Wochen bleiben, `kind` nur in Phasen mit Rhythmus, `hours` höchstens die verfügbare Zeit. Antwort wie bei `phases` mit `changedWeeks` und `staleWeeks`. |
| GET/POST | `/api/coach/volume/recommendation` | Empfohlene Wochenstunden (`minHours`, `averageHours`, `peakHours`, `rationale`, `source` `aiRecommendation` oder `rules`) für das nächste A-Event, dazu `event`, `baseHours`, `recentWeeklyHours` und `canAsk`. POST fragt die KI. |
| GET | `/api/coach/usage?month=2026-10` | Gemessene Tokens und Kosten des Monats, je Modell und Art. |
| GET | `/api/coach/templates` | Template-IDs, Defaults, Parametergrenzen und Dauerregeln. |
| GET | `/api/coach/plan` | Phasen bzw. Trainingsblöcke (`blocks[]` mit berechnetem `status`, `typeName`, `secondaryName`), `frame`, `settings`, gespeicherte Wochen und Revision; frühere Blöcke erscheinen als Plan (`frame.source: "adopted"`). |
| GET | `/api/coach/block-types` | Wählbare Blocktypen mit Längen, Regeln auf Deutsch, vorgeschlagenem Rhythmus (`suggestedRhythm` für die Standardlänge, `rhythms` je erlaubter Wochenzahl; `true` = Entlastung) sowie mögliche Nebenschwerpunkte. |
| POST | `/api/coach/proposals` | `kind: "block"` (mit `mode: "recommend"` oder `"choose"`), `"week"`, `"patch"` oder `"season"` (optional mit `startDate` als Saisonstart); erzeugt einen Vorschlag. |
| POST | `/api/coach/proposals/<id>/confirm` | `{"confirm":true}`, bei Block- und Saisonvorschlägen zusätzlich `"optionId"`; bei Saisonvorschlägen optional `"segments"` (angepasste neue Blöcke ohne die festen); geprüften Vorschlag übernehmen. |
| PUT / DELETE | `/api/coach/season` | `{"segments":[{"blockType","secondaryFocus","weeks","purpose"}], "startDate"?}` ersetzt die Blöcke nach den festen; `startDate` (Montag) verschiebt den Saisonstart, solange kein Block läuft oder bevorsteht, sonst bleibt der gespeicherte Start; DELETE entfernt den Saisonplan, Trainingsblöcke bleiben. `DELETE ?blocks=true` entfernt zusätzlich alle Blöcke, die heute noch laufen oder bevorstehen, mit ihren Wochen und Kalender-Workouts; die Antwort enthält `deletedWorkouts`. |
| DELETE | `/api/coach/blocks/<id>` | Löscht den Block, seine geplanten Wochen und deren Kalender-Workouts (auch vergangene und fixierte, eigene Workouts bleiben); Antwort ist der Plan mit `deletedWorkouts`. |
| POST | `/api/coach/proposals/<id>/discard` | `{}`; Vorschlag verwerfen. |
| PUT | `/api/workouts/<id>/lock` | `{"locked":true}` bzw. `false`; Workout fixieren/lösen. |
| GET / PUT | `/api/coach/blocks/<id>/review` | Blockrückblick: pro Woche Ziel, geplante und absolvierte Stunden/TSS, geplante und gemeldete ausgelassene Einheiten; Summen mit `completion`, Check-in-Mittel und `reflection`. PUT speichert `{"rating":1-5 oder null,"note":"…"}` als Angabe des Athleten am Block. |
| GET | `/api/coach/blocks/<id>/timeline` | Pro Blockwoche ISO-Woche, Phase, Fokus, `targetHours`, `plannedHours` (sofern geplant), `completedHours` (berechnet, laufende Woche bis heute) und `state` (`past`, `current`, `future`). |
| GET | `/api/coach/feedback?week=2026-W39` | Geplante und tatsächlich aufgezeichnete Stunden/TSS einer begonnenen Kalenderwoche, dazu passende Check-ins. Für die laufende Woche gilt `partial: true` und der Stand bis heute. |

Die Endpunkte für Wochen-Overrides, Tages-Overrides, `missed`, Blocktypen, Block- und Saisonvorschläge, Saisonplan, Blöcke, Blockrückblick, Block-Zeitstrahl und `feedback` gehören zum früheren Ablauf. Die Oberfläche nutzt sie nicht mehr; sie bleiben vorerst für Tests und Bestandsdaten.

Beispiele für Vorschlagsanfragen des früheren Ablaufs; die Datumswerte müssen zum tatsächlichen Planungszeitpunkt passen:

```json
{"kind":"block","mode":"recommend","situation":"nach_pause","startDate":"2026-09-28"}
```

```json
{"kind":"block","mode":"choose","blockType":"vo2max","secondaryFocus":"kraft","startDate":"2026-09-28","weeks":4,"instruction":"Lieber kürzere Intervalle."}
```

```json
{"kind":"week","week":"2026-W40","instruction":"Lange Einheit am Samstag bevorzugen."}
```

```json
{"kind":"patch","week":"2026-W41","feedbackWeek":"2026-W40","missedSessions":[],"instruction":"Donnerstag ist jetzt nicht verfügbar; gespeicherte Overrides beachten."}
```

`feedbackWeek` muss begonnen haben; eine laufende Woche geht mit dem Stand bis heute ein. TrainHub ordnet absolvierte Aktivitäten nicht automatisch geplanten Einheiten zu. Daher ist `missedSessions` im berechneten Rückblick zunächst unbekannt; bei einer Vorschlagsanfrage können ausdrücklich athletenseitig gemeldete IDs der Rückblickwoche mitgesendet werden. Ein leeres Array ist die Aussage „keine ausgelassenen Einheiten gemeldet“, keine automatische Erkennung.

## Verifikation

Aus `backend` die Unit- und Integrationstests ausführen:

```powershell
.venv/Scripts/python.exe -m unittest discover -v
```

Aus `frontend`:

```powershell
npm test -- --watchAll=false --runInBand
npm run build
```

Die Coach-Tests prüfen unter anderem Zeitgrenzen, Datenlücken, Bestwertalter, Umfangsfenster, Template-Arithmetik, verschlüsselte Secrets und Provider-Antworten mit Test-Doubles. Ein erfolgreicher Testlauf ist kein Nachweis einer Live-Anfrage an einen AI-Provider. Dafür sind ein vom Nutzer eingerichteter API-Key, passender Modellzugriff und ein bewusster Verbindungstest bzw. Planvorschlag erforderlich.
