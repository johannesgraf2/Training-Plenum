# AI Coach: Einrichtung, Daten und API

TrainHub liefert einen verdichteten Athletenkontext und rendert geplante Einheiten deterministisch. Der AI-Provider entscheidet über Trainingsphasen, Wochenumfang und Template-Auswahl. Jede Empfehlung bleibt ein Vorschlag, bis der Athlet sie ausdrücklich übernimmt.

## Einrichtung und erster Plan

1. Backend-Abhängigkeiten aktualisieren: `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt` aus dem TrainHub-Verzeichnis. Die Erweiterung benötigt zusätzlich `cryptography` und `jsonschema`.
2. Den Serverschlüssel für gespeicherte API-Keys legt TrainHub selbst an: Ist `TRAINHUB_AI_ENCRYPTION_KEY` nicht gesetzt, liest das Backend beim Start `.run/ai-encryption-key.txt` im TrainHub-Verzeichnis und erzeugt die Datei einmalig, falls sie fehlt. `.run/` ist von Git ausgeschlossen. Eine vorhandene Datei wird nie überschrieben, auch keine ungültige; der Provider-Tab meldet sie dann. Der Tab zeigt außerdem, woher der Schlüssel stammt und wo die Datei liegt. Der Schlüssel ist ein Servergeheimnis und kein OpenAI-API-Key.
3. Die Schlüsseldatei getrennt von der Datenbank sichern. Wer den Schlüssel selbst verwalten möchte, setzt `TRAINHUB_AI_ENCRYPTION_KEY` in der Umgebung des Backend-Prozesses; die Variable hat Vorrang vor der Datei. `TRAINHUB_AI_ENCRYPTION_KEY_FILE` wählt einen anderen Dateipfad. Im Docker-Setup liegt die Datei über diese Variable unter `/app/data/ai-encryption-key.txt`, also neben der Datenbank im gemounteten `backend/data`. Einen eigenen Schlüssel erzeugt:

   ```powershell
   backend/.venv/Scripts/python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Ein bereits laufendes Backend muss neu gestartet werden, damit es einen geänderten Schlüssel übernimmt. `start-local.ps1` ersetzt einen bereits auf Port 5000 laufenden Prozess nicht.
4. Nach Frontend-Änderungen in `frontend` mit `npm run build` neu bauen. Backend wie gewohnt über `app.py` starten; dessen Initialisierung ergänzt die Coach-Tabellen und das `locked`-Feld vorhandener geplanter Workouts.
5. In **AI Coach → Athletenprofil** Ziel, normale Tagesverfügbarkeit und absolutes Wochenmaximum speichern. Unter **Deine normale Woche** steht dabei live die Summe, etwa „12 h verfügbar · Wunsch 7 h · Obergrenze 15 h“. Ein Hinweis erscheint, wenn der Wunsch über der Summe der Tage liegt oder deutlich (mindestens 30 % und 1,5 h) vom Wochenschnitt der letzten 28 Tage abweicht. `preferredWeeklyHours` ist der gewünschte normale Umfang; `absoluteMaxWeeklyHours` ist eine verbindliche zeitliche Obergrenze. Ein offener Wert ist unbekannt, `0` bedeutet keine Zeit. Vor der Planung müssen alle sieben Tageswerte und das absolute Wochenmaximum ausgefüllt sein.
6. Unter **AI Provider** den eigenen API-Key und eine Modell-ID speichern und die Verbindung testen. Aktuell ist OpenAI implementiert; das Modell wird aus einer Liste gewählt (Vorgabe im Code: `gpt-4.1-mini`), über „Anderes Modell …“ lässt sich jede andere Modell-ID eintragen. Für Reasoning-Modelle (z. B. `gpt-6-sol`) kann zusätzlich eine Reasoning-Stufe gewählt werden; sie wird als `reasoning.effort` gesendet, zusammen mit mehr Ausgabebudget (40.000 Tokens) und bis zu 5 Minuten Wartezeit. Die Liste ist keine live abgefragte Liste verfügbarer Modelle. Der Account muss Zugriff auf das gewählte Modell haben, und das Modell muss die verwendeten strukturierten Responses unterstützen.
7. Angeben, wo du gerade stehst, und für einen heutigen oder zukünftigen Montag zwei bis drei Trainingsblöcke vorschlagen lassen. Eine Option auswählen und übernehmen. Danach plant der Coach automatisch alle Wochen des Blocks nacheinander mit deiner Standardwoche aus dem Athletenprofil (jede Woche baut auf den vorherigen auf; **Anhalten** stoppt nach der laufenden Woche). Fehlen später Wochen, plant **Restliche Wochen planen** sie nach. Abweichungen einzelner Wochen (Urlaub, Termine) trägst du unter **Ausnahme für diese Woche** ein und lässt die Woche dann über **Woche anpassen** ändern.

Der Tab **Trainingsplan** zeigt immer genau einen nächsten Schritt:

| Zustand | Anzeige |
| --- | --- |
| Einrichtung unvollständig, kein Block | Checkliste ① Athletenprofil · ② AI Provider · ③ Ersten Block planen. Fehlende Profilangaben werden genannt, die Schaltflächen springen in den passenden Tab. |
| Kein Block | Karte **Neuen Trainingsblock starten** mit dem Block-Wizard (siehe unten). |
| Block aktiv oder bevorstehend | Block-Zeitstrahl mit „Woche X von N“ bzw. „Startet am …“, darunter die Trainingswoche. Die Wochenauswahl ist auf den Block begrenzt; ein bevorstehender Block öffnet mit seiner ersten Woche. Solange keine Woche geplant ist, lässt sich der Block unter **Block neu planen** ersetzen. |
| Block beendet | Blockrückblick und darunter der Wizard für den nächsten Block; Verlauf und Einschätzung der letzten Blöcke gehen als Kontext an die KI. |

**Block-Zeitstrahl:** Pro Blockwoche zeigt ein Umriss den geplanten Umfang (gestrichelt: nur Blockziel, Woche noch nicht geplant) und ein gefüllter Balken die aus Trainingsdaten berechneten absolvierten Stunden, für die laufende Woche bis heute. Darüber stehen „absolviert / geplant“ in Stunden, die aktuelle Woche ist mit „Jetzt“ markiert. Ein Klick wählt die Woche zum Planen aus; **Als Tabelle anzeigen** zeigt dieselben Werte mit Fokus.

**Diese Woche:** Coach-Einheiten und eigene Kalender-Workouts der Woche erscheinen gemeinsam. Rad- und Laufeinheiten werden per Schloss direkt an der Einheit fixiert oder gelöst; Krafttraining und Ruhetage haben kein Kalender-Workout und damit kein Schloss. Kurzfristige Änderung und Check-in erscheinen erst, wenn die laufende Kalenderwoche geplant ist.

**Wochenrhythmus:** Oben erscheint **Woche abschließen** mit drei Schritten: Rückblick (geplante gegen bisher absolvierte Stunden und ausgelassene Einheiten ankreuzen), Check-in (optional) und die nächste Woche. Ist sie noch leer, heißt der letzte Schritt **Nächste Woche planen**; ist sie schon geplant, **Nächste Woche anpassen** (Patch) oder **Unverändert lassen** (speichert nur den Rückblick über `PUT /api/coach/weeks/<week>/missed`). Planung und Anpassung erhalten den Rückblick als `feedbackWeek` und die angekreuzten Einheiten als `missedSessions`. Die Karte erscheint ab Freitag, wenn die laufende Woche geplant und noch ohne Rückblick ist, oder sofort, wenn die vergangene Woche geplant, die laufende aber noch leer ist.

**Blockrückblick:** Nach dem Ende eines Blocks zeigt die Karte **So lief dein Block** geplante und absolvierte Stunden, die Umsetzung in Prozent (absolviert von geplant, nur abgeschlossene Wochen mit konkretem Plan), gemeldete ausgelassene Einheiten, den Zeitstrahl aller Wochen und die Mittelwerte deiner Check-ins im Blockzeitraum. Unter **Wie lief der Block für dich?** speicherst du eine Bewertung von 1 bis 5 und eine Notiz. Ausgelassene Einheiten aus dem Wochenrhythmus werden an der Rückblick-Woche gespeichert, sobald die darauf geplante Woche übernommen ist.

Der Block-Wizard führt in vier Schritten zum Block:

1. **Ausgangslage:** „Wo stehst du gerade?“ (nach einer Pause, mitten im Training, Saison vorbei) und Startmontag (Vorgabe: nächster Montag).
2. **Weg:** „Schlag mir was vor“ oder „Ich weiß, was ich will“.
3. **Auswahl:** Beim Vorschlag optional ein Wunsch als Freitext. Bei eigener Wahl Blocktyp-Karten mit Kurzbeschreibung und erlaubter Länge, dazu Wochenzahl (Vorgabe: Standardlänge des Typs), Nebenschwerpunkt, Rhythmus aus Belastungs- und Entlastungswochen und die Regeln des Typs. Wettkampfspezifisch setzt ein Zieldatum voraus, Kraft die Angabe „Fitnessstudio verfügbar“.
4. **Vorschau:** Optionen bzw. der ausgearbeitete Block mit Balken pro Woche, Begründung und Hinweisen. Nach dem Übernehmen plant der Coach alle Wochen des Blocks automatisch; Hinweise der einzelnen Wochen erscheinen gesammelt am Block.

Verwerfen führt zurück zur Auswahl, die Angaben bleiben erhalten.

Ist im Profil ein zukünftiges Zieldatum gespeichert, steht darüber „Noch X Wochen bis …“. Das Saisonziel wird nicht durchgeplant. Zieltypen erscheinen auf Deutsch; der ältere Standardwert `general_endurance` wird als „Allgemeine Ausdauer“ angezeigt und beim nächsten Speichern als `endurance` abgelegt.

Ein Verbindungstest prüft API-Key und Zugriff auf die Modell-ID über den Modell-Endpunkt. Er erzeugt keinen Plan und bestätigt noch nicht, dass eine konkrete Planungsanfrage mit dem Schema erfolgreich sein wird. Generierungen werden über den eigenen Provider-Zugang abgerechnet.

## Architektur und Speicherung

| Modul | Verantwortung |
| --- | --- |
| `backend/athlete_context.py` | Reine Berechnung des Snapshots und abgeschlossener Zeiträume aus vorhandenen Cache-Zusammenfassungen; kein Datenbank- oder Providerzugriff. |
| `backend/analytics.py`, `backend/best_efforts.py` | Bestehende deterministische Sensor-, Zonen-, Normalized-Power- und Bestwertberechnungen mit versionierten Aktivitäts-Caches. |
| `backend/coach_domain.py` | JSON-Schemas, Athletenangaben, ISO-Wochen, effektive Verfügbarkeit und Patch-Operationen. |
| `backend/coach_blocks.py` | Blocktyp-Katalog mit Längen, Rhythmus und Prüfregeln, gespeicherte Blöcke und Migration früherer Makropläne. |
| `backend/coach_season.py` | Saisonplan: Blockfolge bis zum Ziel, feste Blöcke am Anfang, Prüfregeln und Passung zu den geplanten Blöcken. |
| `backend/coach_templates.py` | Template-Katalog, Parametergrenzen, konkrete Dauer und Watt-/HF-Ziele sowie geschätzte geplante Cycling-TSS. |
| `backend/ai_provider.py` | Provider-Abstraktion, Fernet-Ver-/Entschlüsselung, OpenAI-Adapter und Prüfung strukturierter Antworten. |
| `backend/coach_api.py` | Persistenz, Kontext-Auswahl, Vorschläge, serverseitige Beschränkungen, Fixierungen und ausdrückliche Übernahme. |
| `frontend/src/AICoach.jsx` | Athletenprofil, Provider-Einrichtung, Wochenverfügbarkeit, Check-ins und Vorher-/Nachher-Prüfung. |

`athlete_coach_state` speichert Athletenangaben, die Liste bestätigter Trainingsblöcke (`blocks[]`), optional einen Saisonplan (`season`), konkrete Wochen und eine Revision. `ai_provider_settings` speichert Provider, Modell, verschlüsselten API-Key und die letzten vier Zeichen. `coach_proposal` speichert Vorschläge mit Status, Erstellungszeit und einem Fingerabdruck des Ausgangszustands. Bestätigte Rad- und Laufeinheiten verwenden die bestehende Tabelle `planned_workout`; importierte Aktivitäten bleiben davon getrennt.

Das vorhandene `training_plan.py` wurde geprüft: Es enthält deterministische Logik für einen bestehenden vierwöchigen Radtrainingsblock und erzeugt validierte Workouts innerhalb des Backends. Es ist kein separater externer AI-Workflow und bleibt für die bestehenden Abläufe erhalten. Der neue AI Coach verwendet die gemeinsame Analytics- und Workout-Infrastruktur.

## Trainingsblöcke

Ein Trainingsblock hat einen Haupttyp, optional einen Nebenschwerpunkt, einen Startmontag, 1–12 Wochen (ein übernommener Makroplan auch mehr) mit Phase (`base`, `build`, `peak`, `taper`, `recovery`), Zielstunden und Fokus sowie einen Status. Die Regeln stehen zentral in `coach_blocks.py`. `recovery` und `taper` gelten als Entlastungswochen; dort entfallen Mindestanzahlen.

| Typ | Wochen (Standard) | Regeln |
| --- | --- | --- |
| `wiedereinstieg` Wiedereinstieg | 2–4 (3) | Keine VO2max- oder Schwelleneinheit, höchstens 1× Tempo/Sweetspot pro Woche. |
| `grundlage` Grundlage | 6–12 (8) | Keine VO2max-Einheit, höchstens 1 Qualitätseinheit pro Woche, mindestens 80 % der Rad-/Laufzeit locker. |
| `aufbau` Aufbau | 4–12 (6) | Mindestens 2 Qualitätseinheiten pro Belastungswoche, höchstens 1× VO2max. |
| `schwelle` Schwelle | 4–12 (6) | Mindestens 2 Schwellen-/Sweetspot-Einheiten pro Belastungswoche, höchstens 1× VO2max. |
| `vo2max` VO2max | 3–12 (4) | Mindestens 2 VO2max-Einheiten pro Belastungswoche, höchstens 1 Schwellen-/Sweetspot-Einheit. |
| `wettkampfspezifisch` Wettkampfspezifisch | 2–12 (4) | Endet spätestens in der Woche des Zieldatums, letzte Woche mindestens 30 % weniger Umfang als die stärkste Woche davor. |
| `uebergang` Übergang | 1–4 (2) | Keine Qualitätseinheiten, jede Woche höchstens 60 % des Wunschumfangs, kein Entlastungsrhythmus. |

Außer beim Übergang endet jeder Block mit einer Entlastungswoche, und auf höchstens drei Belastungswochen folgt eine Entlastung. Der vorgeschlagene Rhythmus ist 3:1; kürzere Blöcke verwenden 2:1 bzw. passende kürzere Zyklen (5 Wochen: Belastung, Belastung, Entlastung, Belastung, Entlastung). Als Nebenschwerpunkt stehen `kraft`, `laufen` und `radfahren` zur Auswahl; er verlangt mindestens eine passende Einheit pro Belastungswoche, `kraft` zusätzlich die Krafttraining-Verfügbarkeit.

Der Status ist `active`, `completed` (Enddatum vorbei, berechnet) oder `abandoned`. Beginnt ein neuer Block, während ein anderer noch läuft oder bevorsteht, endet dieser am Vortag und gilt als `abandoned`; bereits geplante Wochen gehören weiter zu ihm und bleiben per **Woche anpassen** änderbar. Ein neuer Block darf keine bereits geplante Kalenderwoche überdecken.

Ein früher gespeicherter Makroplan wird beim Lesen zu einem Block vom Typ `custom` („Eigener Block“, ohne Typregeln) mit der festen ID `custom-<Startdatum>` und bei der nächsten bestätigten Änderung im neuen Format gespeichert. `custom` kann für neue Blöcke nicht gewählt werden.

### Zwei Wege in einen Block

| Modus | Anfrage | Antwort und Prüfung |
| --- | --- | --- |
| `recommend` („Schlag mir was vor“) | `situation` (`nach_pause`, `mitten_im_training`, `saison_vorbei`) und `startDate` | 2–3 Optionen, genau eine mit `recommended: true`, jede mit kurzer deutscher Begründung (`rationale`). Verletzt eine Alternative die Regeln, wird sie verworfen und unter `rejectedOptions` mit Grund genannt; eine fehlerhafte Empfehlung lässt den ganzen Vorschlag scheitern. |
| `choose` („Ich weiß, was ich will“) | `blockType`, `secondaryFocus` (oder `null`), `startDate`, `weeks` | Genau eine Option desselben Typs, Nebenschwerpunkts und derselben Länge. Die KI entscheidet nur Umfang, Verteilung, Entlastung und Fokus. Typ, Länge, Kraft-Verfügbarkeit und Zieldatum werden schon vor dem kostenpflichtigen Aufruf geprüft. |

Der Blocktyp geht immer strukturiert an die KI. Ein Freitext (`instruction`) erreicht sie als `athleteWish` mit Herkunft `athlete` und präzisiert die Anfrage nur; er ist Datenmaterial, keine Anweisung. Jede Option durchläuft die Blockregeln, die Verfügbarkeit jeder Woche, das Wochenmaximum und die Platzierung neben bestehenden Blöcken.

Block-, Wochen- und Patch-Antworten enthalten `hinweise[]`: kurze deutsche Bedenken der KI, zum Beispiel zu geringem Umfang in der letzten Woche. Sie werden angezeigt, blockieren aber nichts. Harte Grenzen prüft ausschließlich der Server. Beim Planen und Anpassen einer Woche gelten zusätzlich die Wochenregeln des Blocktyps aus der Tabelle oben.

### Trainingsgrundsätze und Steigerungsketten

Die KI plant nach festen Grundsätzen: Der Großteil des Umfangs ist locker, wenige harte Einheiten setzen gezielte Reize. Steigerung heißt mehr Zeit im Zielbereich (mehr Wiederholungen, Sätze oder längere Intervalle), nicht höhere Watt; die Intensität ist so gewählt, dass auch die letzte Wiederholung kontrolliert bleibt. Formate mit demselben Ziel wechseln sich ab. Jeder Blocktyp nennt der KI typische Steigerungsketten, zum Beispiel im VO₂max-Block 5×3 → 5×5 → 5×6/6×5 min und 3×9 → 3×11 → 3×13 × 30/15, später 3×10 × 40/20, begleitet von 1–3 h lockeren Fahrten und gelegentlichen SIT; im Grundlagenblock wächst die lange Fahrt von 1:30 auf 3 h. Die Ketten stehen in `coach_blocks.py` und sind Hinweise, keine harten Regeln.

## Saisonplan bis zum Ziel

Mit einem Zieldatum im Profil kann der Coach die Zeit bis zum Ziel in eine Folge von Trainingsblöcken aufteilen. Die Trainingsphilosophie: erst die aerobe Grundlage, dann mit VO2max den Motor vergrößern, mit Schwelle die VLamax senken und die Schwelle anheben, zum Schluss wettkampfspezifisch mit Taper. Der Server rechnet diesen Aufbau als `typicalSeason` mit Längen passend zur Zielwoche vor (lange Saisons mit wenigen langen Blöcken bis 12 Wochen); die Empfehlung folgt ihm, Alternativen setzen zum Beispiel Schwelle vor VO2max oder verlängern die Grundlage. Der Saisonplan ist ein Fahrplan: Konkret ausgearbeitet wird weiterhin immer nur der nächste Block über den normalen Blockablauf. Endet ein Block, schlägt der Assistent den nächsten Block des Saisonplans mit Typ, Länge und Start vor; du kannst ihn noch ändern.

- **Vorschlag:** Die KI liefert 2–3 Saisonpläne, genau einer ist die Empfehlung. Sie erhält Ziel, Snapshot, bisherige Blöcke mit Rückblick, den Blockkatalog und einen bestehenden Saisonplan. Ein Freitext geht als `athleteWish` mit.
- **Feste Blöcke:** Laufende und geplante Blöcke stehen fest am Anfang, im Editor als gesperrte erste Zeilen. Geplant wird ab dem ersten freien Montag danach; die Wochensumme zählt nur die freien Wochen.
- **Regeln (Server):** Die Blöcke füllen jede Woche bis einschließlich der Zielwoche lückenlos, jeder Block liegt in den Längengrenzen seines Typs, Kraft als Nebenschwerpunkt braucht Krafttraining-Verfügbarkeit, der letzte Block ist wettkampfspezifisch. Höchstens 20 neue Blöcke und 104 Wochen. Vorschläge der KI halten zusätzlich die Reihenfolge ein: optional Wiedereinstieg, Grundlage, VO2max und Schwelle in beliebiger Folge, Wettkampfspezifisch; kein Aufbau oder Übergang, kein Zurück zur Grundlage und jeder Typ nur an einem Stück. Eigene Anpassungen dürfen davon abweichen. Eine fehlerhafte Alternative wird verworfen, eine fehlerhafte Empfehlung lässt den Vorschlag scheitern.
- **Anpassen:** Vor dem Übernehmen und jederzeit danach lassen sich Blöcke verschieben, im Typ, in der Länge und im Nebenschwerpunkt ändern, entfernen oder hinzufügen. Dieselben Regeln gelten; der Editor zeigt Verstöße schon beim Bearbeiten als kurze Zeile neben der Wochensumme, auch wenn die Blöcke selbst mit ihren Höchstlängen nicht bis zum Ziel reichen. Ein angepasster Plan trägt die Herkunft `athleteEdited`.
- **Passung:** Weicht ein bestätigter Block vom Saisonplan ab oder ändert sich das Zieldatum, zeigt der Saisonplan das an (`aligned`, `goalChanged`); du passt ihn dann an oder lässt ihn neu vorschlagen.
- **Blockvorschläge** erhalten den Saisonplan als `seasonPlan` und folgen ihm, wenn nichts im jüngsten Training dagegen spricht.

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

## Verfügbarkeit, Templates und Planänderungen

Die Priorität lautet **Standardwoche → Wochen-Override → Tages-Override**. Wochen werden als `YYYY-Www`, Tage als `YYYY-MM-DD` gespeichert. `available: false` oder ein Tages-`action: "skip"` ergibt null verfügbare Minuten. Overrides ändern die Standardwerte nicht. Die Verfügbarkeit ist ein Zeitrahmen, keine Pflicht: Im Profil legst du zusätzlich fest, an wie vielen Tagen pro Woche du trainieren willst, ob gerade Winter (Rolle), Sommer (draußen) oder gemischt ist, und wie lange eine normale Radeinheit auf der Rolle bzw. draußen mindestens dauert (bei „gemischt“ gilt der kürzere Wert). Regenerationsfahrten sind ausgenommen. TrainHub lehnt AI-Wochen ab, die mehr Trainingstage oder kürzere Radeinheiten enthalten; bestehende, unveränderte Einheiten zählen nicht als Verstoß. Wochen-Overrides werden für höchstens 104 Wochen, Tages-Overrides für 366 Tage und Check-ins für 90 Datumswerte aufbewahrt.

Der Katalog umfasst Regeneration, kurze/lange Grundlage, Grundlage mit Sprints, Tempo, Sweetspot, Schwelle, VO₂-Intervalle, VO₂-Mikrointervalle in Sätzen (z. B. 3×13×30/15 oder 3×10×40/20, jeder Satz ein Wiederholungsblock auf dem Gerät) und Sprintintervalle (SIT, z. B. 6×30 s mit 4 min Pause) am Rad sowie lockere, Schwellen- und lange Läufe, allgemeines Krafttraining und Ruhetage. Harte Radeinheiten können eine Trittfrequenz bekommen, die im Namen jedes harten Abschnitts steht (z. B. „Hart · 100 U/min“); das Wattziel bleibt das Ziel des Schritts. Einheiten heißen nach ihrer Struktur, etwa „VO2-Mikrointervalle Rad 3×13×30/15“. Jede Einheit bekommt einen festen Verpflegungshinweis nach Art und Dauer: bei HIT vorher und währenddessen Kohlenhydrate, bei intensiven Einheiten Kohlenhydrate während der Einheit, bei kurzen lockeren Einheiten optional nur Wasser und danach Protein, ab 90 min etwas und ab 150 min regelmäßig Kohlenhydrate. Der Hinweis steht in der Wochenansicht, ist im Workout-Editor änderbar (Feld `notes`, höchstens 250 Byte) und erscheint auf der Garmin als Beschreibung des Workouts (`wkt_description`). Er ist eine allgemeine Orientierung, keine Ernährungsberatung. Mikrointervalle zählen als VO₂max-Einheit, SIT als Qualitätseinheit (im Wiedereinstieg nicht erlaubt), Grundlage mit Sprints als lockere Einheit; für den Anteil lockeren Trainings zählt nur die reine Belastungszeit als hart. Die AI wählt Template und Parameter. TrainHub prüft deren Grenzen und erzeugt Aufwärmen, Belastung, Erholung und Abwärmen. Intervall-Einheiten am Rad können eine Gesamtdauer (`durationMin`) bekommen; die zusätzliche Zeit wird als lockere Grundlage (65 % FTP) vor und nach den Intervallen gefahren, z. B. 2 h mit 5×5 min. Radziele basieren auf FTP, Laufziele auf maximaler HF; ohne Schwelle bleiben Ziele offen. Dauer und geplante Cycling-TSS werden deterministisch berechnet. Die geplante TSS ist eine Schätzung aus den Zielwerten und bleibt von tatsächlich absolvierter Belastung getrennt.

Rad- und Laufworkouts werden nach Bestätigung in den bestehenden Kalender übernommen und können dessen Editor/FIT-Export nutzen. Krafttraining und Ruhetage werden in der Coach-Woche gespeichert und angezeigt; sie erzeugen derzeit kein Garmin-Workout und keinen eigenen Eintrag im bestehenden Workout-Kalender. Krafttraining verlangt `gymAvailability: true`.

Vorhandene eigene Kalenderworkouts zählen als feste Verpflichtungen zur verfügbaren Zeit. Bereits bearbeitete Coach-Workouts werden beim Laden mit dem Kalender abgeglichen. Rad-/Laufworkouts können fixiert werden; ein AI-Patch darf sie weder verschieben, ersetzen noch löschen. Auch bestehende nicht zum Coach gehörende Kalenderworkouts werden durch die Planung nicht überschrieben.

Ein Wochen-Patch enthält ausschließlich `add`, `replace` oder `remove` für einzelne Session-IDs sowie aktualisierte Zielstunden und Fokus. Unbekannte oder doppelte IDs, Änderungen fixierter oder vergangener Einheiten, falsche Kalenderwochen, Zeitüberschreitungen und unplausible Abweichungen zwischen Zielstunden und gerenderter Dauer werden abgelehnt. Bei den Wochenstunden zählen auch vorhandene Kalendereinheiten mit. Die zulässige Rundungsabweichung ist ungefähr 15 Minuten.

Die API speichert zunächst einen Vorschlag mit `before`, `after`, `hinweise` und der strukturierten Entscheidung. **Verwerfen** ändert den Plan nicht. Erst die ausdrückliche Übernahme mit `{"confirm":true}` (bei Blockvorschlägen `{"confirm":true,"optionId":"…"}`) schreibt den bestätigten Plan und die betroffenen Workouts in einer Transaktion. Ein veränderter Ausgangszustand (Profil, Planung, Trainings-/Kalenderstand oder Provider-Einstellungen) macht den Vorschlag ungültig. Vorschläge verfallen nach 24 Stunden; Wiederholung einer erfolgreichen Bestätigung erzeugt keine doppelten Workouts.

## Provider, Übertragung und Schlüssel

Der Provider bekommt kompaktes JSON ohne vollständige Sensorstreams, GPS-Tracks, Original-FIT-Dateien oder API-Key im Planungskontext. Die lokalen Caches können bei Bedarf aus vorhandenen Aufzeichnungen aufgebaut werden; diese Rohdaten verlassen dabei TrainHub nicht. Ziele, Notizen und subjektive Check-ins gehören zum Kontext und werden bei entsprechenden Planungsanfragen an den gewählten Provider übertragen.

Ein Trainingsblock-Vorschlag erhält den Snapshot, Startdatum, Modus, Ausgangslage bzw. die eigene Wahl, den Blockkatalog mit Regeln und die letzten drei Blöcke mit Wochenverlauf, Summen, Check-in-Mitteln und deiner Einschätzung; ältere Check-ins und Overrides werden aus diesem Provider-Kontext gekürzt. Eine neue konkrete Woche erhält nur den zugehörigen Block (Typ, Nebenschwerpunkt, Woche X von N, Regeln) und dessen Blockwoche, aktuelle Verfügbarkeit, kompakte Plan-/Template-Informationen, die bisher geplanten Wochen desselben Blocks (`blockHistory`, damit Einheiten entlang ihrer Steigerungsketten weiterlaufen), jüngstes Training, dein Trainingsmuster der letzten 8 vollständigen Wochen (`recentPattern`: Einheiten und Trainingstage pro Woche, typische Dauer) und deine Trainingsvorgaben (`trainingRules`). Ein Patch verwendet den bestehenden kompakten Wochenplan und gegebenenfalls einen abgeschlossenen Wochenrückblick, ohne erneut die vollständige Historie zu schicken. Es wird kein fortlaufender Chatverlauf gespeichert oder übertragen.

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
| GET / PUT | `/api/athlete-profile` | Ziel, Verfügbarkeit, Präferenzen, Einschränkungen, aktuelle Selbsteinschätzung. PUT ersetzt die angegebenen vollständigen Teilbereiche; bei `availability` und `preferences` behalten fehlende Felder ihren gespeicherten Wert. |
| PUT | `/api/coach/weeks/<week>/missed` | `{"missedSessions":["id"]}` speichert den Wochenrückblick ohne neue Planung; die IDs gehören zu dieser Woche. |
| PUT | `/api/coach/weekly-overrides/<week>` | `{"overrides":{"thu":{"available":false},"sat":{"maxMinutes":300,"preferLong":true}},"note":"Reisewoche"}`. |
| PUT | `/api/coach/daily-overrides/<date>` | Zum Beispiel `{"maxMinutes":45,"action":"reduce","note":"Wenig Zeit"}`. |
| POST | `/api/coach/check-ins` | Datum, `fatigue`, `motivation`, `stress`, `sleepQuality`, `soreness` jeweils 1–5 sowie `notes`. |
| GET / PUT / DELETE | `/api/ai-provider` | Status lesen, `{"provider":"openai","model":"gpt-4.1-mini","reasoningEffort":null,"apiKey":"…"}` speichern (`reasoningEffort`: `null` oder `none`, `minimal`, `low`, `medium`, `high`, `xhigh`) oder gespeicherten Key entfernen. Beim Modellwechsel kann `apiKey` entfallen. |
| POST | `/api/ai-provider/test` | `{}`; Zugang und Modell prüfen. |
| GET | `/api/coach/templates` | Template-IDs, Defaults, Parametergrenzen und Dauerregeln. |
| GET | `/api/coach/plan` | Bestätigte Trainingsblöcke (`blocks[]` mit berechnetem `status`, `typeName`, `secondaryName`), gespeicherte Wochen und Revision. |
| GET | `/api/coach/block-types` | Wählbare Blocktypen mit Längen, Regeln auf Deutsch, vorgeschlagenem Rhythmus (`suggestedRhythm` für die Standardlänge, `rhythms` je erlaubter Wochenzahl; `true` = Entlastung) sowie mögliche Nebenschwerpunkte. |
| POST | `/api/coach/proposals` | `kind: "block"` (mit `mode: "recommend"` oder `"choose"`), `"week"`, `"patch"` oder `"season"`; erzeugt einen Vorschlag. |
| POST | `/api/coach/proposals/<id>/confirm` | `{"confirm":true}`, bei Block- und Saisonvorschlägen zusätzlich `"optionId"`; bei Saisonvorschlägen optional `"segments"` (angepasste neue Blöcke ohne die festen); geprüften Vorschlag übernehmen. |
| PUT / DELETE | `/api/coach/season` | `{"segments":[{"blockType","secondaryFocus","weeks","purpose"}]}` ersetzt die Blöcke nach den festen; DELETE entfernt den Saisonplan, Trainingsblöcke bleiben. |
| POST | `/api/coach/proposals/<id>/discard` | `{}`; Vorschlag verwerfen. |
| PUT | `/api/workouts/<id>/lock` | `{"locked":true}` bzw. `false`; Workout fixieren/lösen. |
| GET / PUT | `/api/coach/blocks/<id>/review` | Blockrückblick: pro Woche Ziel, geplante und absolvierte Stunden/TSS, geplante und gemeldete ausgelassene Einheiten; Summen mit `completion`, Check-in-Mittel und `reflection`. PUT speichert `{"rating":1-5 oder null,"note":"…"}` als Angabe des Athleten am Block. |
| GET | `/api/coach/blocks/<id>/timeline` | Pro Blockwoche ISO-Woche, Phase, Fokus, `targetHours`, `plannedHours` (sofern geplant), `completedHours` (berechnet, laufende Woche bis heute) und `state` (`past`, `current`, `future`). |
| GET | `/api/coach/feedback?week=2026-W39` | Geplante und tatsächlich aufgezeichnete Stunden/TSS einer begonnenen Kalenderwoche, dazu passende Check-ins. Für die laufende Woche gilt `partial: true` und der Stand bis heute. |

Beispiele für Vorschlagsanfragen; die Datumswerte müssen zum tatsächlichen Planungszeitpunkt passen:

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
