# Onboarding und Blockplanung

Umsetzung der Featureliste `Training-Plenum_Features.md` vom 17.10.2026.

Der erste Einstieg öffnet das Onboarding. Die Tagesabfrage wartet auf den
Abschluss der Einrichtung (`ready`/`created`). Bestehende Phasenpläne, auch
übernommene ältere Pläne, gelten weiterhin als eingerichtet.

## Verhalten

- ONB-01–02: Einrichtung vor Tagesabfrage; bisheriger durchschnittlicher
  Trainingsumfang bleibt im Hintergrundprofil, getrennt vom Zeitbudget.
- ONB-03–06: Neuer Eventplatzhalter, Untertyp direkt bei der Sportart,
  erhaltener Evententwurf bei Feld- und Schrittwechseln sowie ein Kalender,
  der vollständige lokale Datumswerte für „Heute“ vergleicht. Auswahl und
  heutiger Tag haben getrennte Markierungen.
- ONB-07: Selbst eingegebene Schwellenpace oder 10-km-Pace mit gespeichertem
  `referenceType`. Es gibt keine automatische Umrechnung von 10-km-Pace;
  bis eine Schwelle bekannt ist, bleiben Laufziele nach Puls oder Gefühl.
  Bestehende Werte ohne Typ bleiben Schwellenpace. Selbsteingabe,
  Datenableitung und Tests bleiben vorhanden.
- ONB-08: A-, B- und C-Events tragen ihren Namen auf dem Zeitstrahl.
- ONB-09: Kopiert wird beim abschließenden Speichern des Tagesformulars,
  einschließlich Status, Zeit, Sportoptionen und Gruppentraining. Gewählte
  Zieltage und der Speicherzeitpunkt sind sichtbar; die Wochenansicht
  verwendet sofort die gespeicherten Fenster.
- ONB-10–15: Wochenvorgaben stehen vor den Tagen. Ruhetage und mögliche
  lange Trainingstage sind mehrfach auswählbar. Zeitbudget, bisheriger
  Durchschnitt und die bestehende Eventempfehlung sind getrennt beschriftet.
  Der Informationsbutton erklärt die vorhandene Anpassung einzelner Wochen
  und das direkte Verschieben/Ändern im Kalender und Workouteditor.
- PLAN-01–02: „Ändern“ öffnet den Blockeditor. Blöcke lassen sich verschieben,
  umsortieren, verlängern, hinzufügen und entfernen. Wochenlängen haben
  keine feste Typobergrenze und die Bearbeitung kein zeitliches Fenster.
  Änderungen gehen direkt an `PUT /api/coach/plan/phases`, ohne KI-Aufruf.
- PLAN-03–04: Ein oder zwei Taperwochen am A-Event, rückwärts verankerter
  Belastungsrhythmus und ein Stundenverlauf bis zum Planende mit genauen
  Werten je Woche und einer Tabelle.
- PLAN-05–06: Standardmäßig drei auszuarbeitende Wochen, frei erhöhbar bis
  zum tatsächlichen Planende. „Wochen ausarbeiten“ erzeugt fehlende Wochen
  ab der aktuellen Woche oder dem späteren Planstart. Phasen und Zielstunden
  aller übrigen Wochen bleiben als „Vorgemerkt“ sichtbar. Auch das rollende
  Nachplanen verwendet den eingestellten Horizont.

## Festgelegte Regeln für die offenen Punkte

Diese Regeln sind Implementierungsentscheidungen zu den im Dokument offenen
Details, keine nachträglich behaupteten ausdrücklichen Nutzerentscheidungen.

- „Durchschnittlich“ bei Selbstauskunft bezeichnet eine typische vergangene
  Trainingswoche ohne vorgeschriebenen Zeitraum. Die vorhandene Ableitung
  aus Aktivitäten zeigt weiterhin ihren Bezugszeitraum von sechs Wochen.
- Alle gewählten Ruhetage sind weiche Präferenzen, keine Sperrzeiten. Die
  langen Trainingstage sind Alternativen, keine Pflichttermine. Alte
  Einzelauswahlen werden in Listen übernommen; alte Clients bleiben lesbar.
- Eventdatum und Planende bleiben fest. Eine Verlängerung verschiebt im Editor
  die folgenden Blöcke. Der Nutzer gleicht andere Dauern an, bevor er speichert.
  Lücken, Überlappungen, eine falsche Gesamtlänge oder ein nicht am A-Event
  liegender Taper werden mit einer konkreten Konfliktmeldung abgewiesen.
- Phasen und Grafik verwenden Montag–Sonntag-Planwochen. Der Taper liegt
  einschließlich der Eventwoche am A-Event; am Eventtag gibt es wie bisher
  keine zusätzliche Trainingseinheit. Mehrere A-Events erhalten eigene Taper.
- Vor dem Taper gilt rückwärts ein 3:1-Rhythmus, auch über Blockgrenzen. Nach
  dem letzten Ziel beziehungsweise ohne A-Event läuft er vorwärts weiter.
  Übergangsblöcke bleiben Entlastung. Ein anfänglicher Teilzyklus ist möglich.
- Die Ausgangsstunden stammen aus dem gespeicherten Trainingsdurchschnitt,
  sonst dem gemessenen Durchschnitt. Bei älteren Profilen ohne beides dient
  der bisherige Wunschumfang als Kompatibilitätswert, sonst 3 Stunden; für
  Neueinstieg mit 0 Stunden beginnt die Orientierung bei 1 Stunde. Belastungs-
  wochen steigen um 5 % der Ausgangsstunden je Belastungswoche. Entlastung
  nutzt 70 %, Taper 60 % beziehungsweise 45 % in der letzten Taperwoche.
  Zielstunden werden auf Viertelstunden abgerundet und durch Tagesfenster,
  Ausnahmen und Wochenmaximum begrenzt. Diese Orientierung ist keine
  physiologische Messung. Neue konkrete Wochen dürfen das Ziel nur um die
  bestehende 15-Minuten-Toleranz überschreiten; feste eigene Termine werden
  dabei als bestehende Verpflichtungen berücksichtigt.
- Vorhandene Einheiten, Fixierungen und Rückblicke werden nach einer manuellen
  Blockänderung erhalten. Neue Zielstunden gelten sofort für Phase, Grafik,
  Vorschau und Wochenkarte. Konkrete Wochen werden zur Prüfung markiert;
  „Woche anpassen“ zeigt Änderungen vor der Übernahme. Eine bestätigte
  Wochenanpassung synchronisiert die Stunden zurück in die Phasenübersicht.
- Revisionen schützen vor dem Überschreiben zwischenzeitlicher Änderungen.
  Während laufender Planungsjobs nimmt der Blockeditor keine Änderungen an.
  Ein großer Generierungshorizont wird auf vorhandene Planwochen begrenzt.

## Prüfen

```sh
.venv/bin/python -m unittest discover -s backend
CI=true npm test --prefix frontend -- --watchAll=false --runInBand
CI=true npm run build --prefix frontend
```

Regressionen decken Datumswechsel, Titelentwürfe, Mehrfachpräferenzen,
Verfügbarkeitskopien, Pace-Werttypen, feste Eventtermine, lange Blöcke,
deterministische Änderungen, unveränderte Kalenderworkouts, konkurrierende
Revisionen, gemeinsame Zielstunden und einen Horizont von fünf Wochen ab.
