# AI Coach: UX-Spezifikation (Entwurf)

Stand: 16.10.2026 · Status: in Abstimmung, noch nicht implementiert. Orientiert sich am Ablauf von MATS, ergänzt um eigene Stärken: vorhandene Trainingsdaten, Morgen-Check-in mit Ampel, BYOK, Garmin-Export.

## 1. Leitlinien

1. **Ein Denkmodell:** Ziel → Plan mit Phasen → die nächsten 3 Wochen konkret → wöchentlich rollierend nachplanen.
2. **Keine Planungs-Fachbegriffe in der Bedienung.** Blöcke, Saisonplan-Optionen, Patches und „Wochen angleichen“ gibt es für den Nutzer nicht mehr. Die Blockregeln im Backend bleiben und bestimmen die Phasen unsichtbar.
3. **Erst zeigen, was wir wissen, dann fragen.** Was sich aus den Trainingsdaten ablesen lässt, wird vorausgefüllt und nur bestätigt.
4. **Geführt statt Formular:** Ein Schritt pro Bildschirm, Fortschrittsbalken, unten immer „Zurück“ und „Weiter“.
5. **Alles bleibt später änderbar.** Jede Eingabe aus dem Onboarding ist in den Einstellungen mit demselben Editor erreichbar.
6. **Jede Woche und jede Einheit sagt, warum.** Ein Satz zum Zweck, sichtbar ohne Aufklappen.
7. **Der Plan ist sofort aktiv.** Die Zusammenfassung vor dem Erstellen ist die Bestätigung. Nur spätere Anpassungen zeigen ein Vorher/Nachher.

## 2. Begriffe in der Oberfläche

| Begriff | Bedeutung |
| --- | --- |
| Plan | Alles vom Start bis zum A-Event, gegliedert in Phasen. |
| Phase | Grundlage, Aufbau (VO2max, Schwelle), Wettkampfspezifisch, Taper, Erholung. Nur Anzeige, nicht bedienbar. |
| Woche | Ausgearbeitet (mit Einheiten) oder vorgemerkt (nur Phase und Zielstunden). |
| Einheit | Ein konkretes Workout mit Struktur, Zielen, Zweck und Verpflegungshinweis. |
| Event | Wettkampf oder Veranstaltung mit Priorität A, B oder C. |
| Ziel ohne Event | „VO2max verbessern“, „Schwelle erhöhen“ oder „Allgemein fit“. |
| Verfügbarkeiten | Wiederkehrende Zeitfenster pro Wochentag mit den dort möglichen Sportarten, dazu einmalige Ausnahmen. |
| Check-in | Morgendliche Abfrage mit Tagesampel (wie bisher). |
| Wochenrückblick | Kurze Abfrage am Wochenende, danach wird nachgeplant. |

## 3. Sportarten

Wie bei MATS:

| Sportart | Art | Event-Untertypen | Primärmetrik (Auswahl) | Optionen pro Verfügbarkeit |
| --- | --- | --- | --- | --- |
| Swim | Einzeln | Becken, Freiwasser, Custom | Pace (CSS), RPE | Freiwasser auch möglich |
| Bike | Einzeln | Kriterium, Cyclocross, Zeitfahren, Cross Country, Straßenrennen, Gran Fondo, XC Marathon, Gravel, Ultra, Custom | Leistung, Herzfrequenz | Rolle, draußen |
| Run | Einzeln | 5 km, 10 km, Halbmarathon, Marathon, Trail, Ultra, Custom | Pace, Herzfrequenz, Leistung | Laufband, draußen |
| Strength & Core | Einzeln | (kein Event) | RPE | Equipment: Studio, Kurzhanteln, Kettlebell, Eigengewicht |
| XC Ski | Einzeln | Klassisch, Skating, Volkslauf/Marathon, Custom | Herzfrequenz | Skiroller, Schnee |
| Hyrox | Multisport | Open, Pro, Doubles, Relay | Herzfrequenz, RPE | Equipment wie Kraft |
| Triathlon | Multisport | Sprint, Olympisch, Mitteldistanz, Langdistanz, Custom | je Disziplin | |
| Duathlon | Multisport | Sprint, Standard, Custom | je Disziplin | |
| Other | nur Event | Custom | | |

Multisport-Events wählen ihre Disziplinen automatisch mit aus. Ein Triathlon bringt also Swim, Bike und Run mit, und diese sind im Plan gesperrt.

## 4. Navigation

Der Coach hat drei Bereiche:

- **Heute:** Check-in, Ampel, heutige Einheit(en), Ausblick auf die nächsten Tage.
- **Plan:** Phasenleiste bis zum Event, Wochen, Events, Verlauf.
- **Einstellungen:** Athletenprofil, Sportarten, Leistungsdaten, Verfügbarkeiten, Events und Ziele, Datenquellen, AI-Provider, Coach-Verhalten.

Ohne Plan zeigen „Heute“ und „Plan“ eine Startkarte: „Lass uns deinen Plan bauen“ → Onboarding.

Heutige Bereiche, die entfallen oder aufgehen: Woche und Saison gehen in **Plan** auf. Rückblick wird zum **Verlauf** im Plan. Athletenprofil und AI Provider wandern in die **Einstellungen**.

## 5. Onboarding Teil A: Athletenprofil (einmalig)

Ein Fortschrittsbalken mit 4 Abschnitten. Wird übersprungen, wenn das Profil schon vollständig ist.

### A1 Deine Sportarten
„Wähle die Sportarten aus, die du regelmäßig machst.“ Liste aus Abschnitt 3 (ohne Other), Mehrfachauswahl. **Vorauswahl aus den Daten:** Sportarten mit Aktivitäten in den letzten 90 Tagen sind angehakt und tragen den Hinweis „aus deinen Daten“.

### A2 Verbinde deine Daten
Karten mit Status „Verbunden“ oder „Verbinden“ und dem, was sie liefern (Aktivitäten, Gesundheitsdaten, Workout-Export):
- Garmin (Aktivitäten, Workout-Export)
- WHOOP (Erholung, Schlaf)
- Dateien & Exporte (FIT, GPX, TCX, TrainingPeaks, Strava-Export)

Der Schritt lässt sich überspringen. Ohne Daten fragt Teil B nach statt vorzufüllen.

### A3 Deine Leistungsdaten
Gewicht, Alter, max. HF und je gewählter Sportart der Schwellenwert: FTP (Bike), Schwellenpace (Run), CSS (Swim). Jeder Wert zeigt seine Herkunft: „aus deinen Daten: 285 W, abgeleitet aus 20-min-Bestwert vom 12.09.“ oder „von dir eingetragen“. „Weiß ich nicht“ ist erlaubt. Dann plant der Coach einen Test in den ersten Wochen ein.

### A4 Dein AI-Provider
Provider, Modell, API-Key und Verbindungstest (wie heute, nur als Schritt). Ein Satz zu BYOK: „Deine Anfragen laufen über deinen eigenen Zugang und werden dort abgerechnet.“ Ohne verbundenen Provider kann Teil B nicht abgeschlossen werden. Der Schritt erscheint deshalb spätestens vor „Plan erstellen“.

## 6. Onboarding Teil B: Plan erstellen (6 Schritte)

Bottom-Sheet bzw. Vollbild mit 6 Abschnitten im Fortschrittsbalken. Alle Eingaben bleiben erhalten, wenn man zurückgeht oder abbricht (Entwurf).

### B1 Dein Hintergrund
„Erzähl mir von deinem Training – was, wie viel und welche Art.“

**Mit Daten**, eine Karte „Das sehe ich in deinen Daten“:
- Hauptsportart der letzten 6 Wochen, z. B. „Radfahrer“ (Kacheln wie bei MATS, vorausgewählt, änderbar)
- Ø Stunden pro Woche (letzte 6 Wochen), daneben die stärkste 4-Wochen-Phase
- Intervalle in den letzten 21 Tagen pro Sportart: „Rad: ja, zuletzt am 03.10.“
- Button „Stimmt so“ oder einzelne Werte korrigieren (Slider, Ja/Nein)

**Ohne Daten**, wie MATS:
- „Was hast du zuletzt gemacht?“ Kacheln: Triathlon (Kurz), Triathlon (Mittel/Lang), Duathlon, Läufer, Radfahrer, Schwimmer, Hyrox, XC Ski, Etwas anderes
- „Wie viele Stunden pro Woche?“ Slider mit +/−
- „Hast du in den letzten 21 Tagen Intervalle trainiert?“ Ja/Nein pro gewählter Sportart

### B2 Dein Ziel
„Überprüfe deine kommenden Events und füge fehlende Rennen oder Ziele hinzu.“
- Großer Button **„+ Event hinzufügen“**
- Darunter „Oder setze dir ein Ziel“: VO2max verbessern · Schwelle erhöhen · Allgemein fit
- Listen „Kommende Events“ und „Kürzliche Events“ (letzte 14 Tage, verschieben den Planstart, damit Erholung eingeplant wird)

**Event-Formular**
| Feld | Eingabe | Hinweis |
| --- | --- | --- |
| Titel | Text | z. B. „NorthCape 4000“ |
| Sportart | Kacheln aus Abschnitt 3 | |
| Mehrtägig | Schalter | Start- und Enddatum |
| Ganzer Tag / Uhrzeit | Schalter oder Uhrzeit | |
| Ort | Suche | optional |
| Priorität | A · B · C | mit Erklärung je Stufe |
| Ziel (Untertyp) | Liste je Sportart | z. B. Ultra |
| Distanz | **freies Zahlenfeld mit Einheit, bis 10.000 km** | MATS begrenzt den Picker auf 1.000 km, NorthCape 4000 braucht 4.000 km |
| Zeit | **Tage + Stunden + Minuten** oder „nur ankommen“ | Für Mehrtagesrennen wie 10 d 12 h |
| Höhenmeter | freies Zahlenfeld bis 100.000 m | |
| Beschreibung | Text | geht als Wunsch an den Coach |

Prüfungen: Enddatum ≥ Startdatum. Distanz und Zeit passen grob zum Untertyp. Ist das nicht so, gibt es einen Hinweis, aber keine Sperre (Ultra darf alles).

**Optionen für B- und C-Events**, im Formular unter „Wie soll der Coach damit umgehen?“:
| | Vorher | Am Tag | Danach |
| --- | --- | --- | --- |
| A (fest) | voller Taper (1–3 Wochen je nach Event) | Rennen | Erholungswoche |
| B (Standard) | Mini-Taper 3–4 Tage | Rennen | 2–4 Tage locker |
| B (Alternative) | ohne Taper, „durchtrainieren“ | Rennen | 2 Tage locker |
| C (Standard) | nichts | ersetzt die harte Einheit der Woche | 1 Tag locker |
| C (Alternative) | nichts | als lockere Teilnahme | normal weiter |

### B3 Wähle deine Sportarten
„Wähle die Sportarten, die du in deinen Trainingsplan aufnehmen möchtest.“
- **Basierend auf deinen Events:** vorausgewählt und gesperrt (Schloss-Symbol)
- **Multisport** und **Einzelne Sportarten:** wählbar, vorausgewählt aus A1
- **Details** pro gewählter Sportart: Primärmetrik (Leistung/HF/Pace)

### B4 Zeitraum
„Wähle Start- und Enddatum deines Plans.“
- Startdatum: Vorgabe ist der nächste Montag bzw. nach der Erholung von einem kürzlichen Event
- Plan-Enddatum: Vorgabe ist das Ende des letzten A-Events
- **Zeitstrahl** mit allen Events im Zeitraum (A groß, B und C klein), damit B- und C-Events sichtbar eingeplant sind
- Hinweis bei Grenzen: „Das Plan-Enddatum darf nicht später als … sein.“

### B5 Verfügbarkeiten
„Sag mir, wann du trainieren kannst.“

Liste Montag bis Sonntag, je Tag „+ Neue Verfügbarkeit“ und die vorhandenen Einträge („Di 18:00–19:00 · Bike, Run“).

**Vorschlag aus den Daten** (eigene Idee): „Du trainierst meist Di und Do abends und am Wochenende lang. Übernehmen?“ Das füllt typische Zeitfenster aus den Startzeiten der letzten 8 Wochen vor.

**Neue Verfügbarkeit**, Unterablauf mit 2 Schritten:
1. „Wann trainierst du?“
   - Art: **Verfügbar** / **Nicht verfügbar**
   - Zeitraum: von–bis oder **Den ganzen Tag**
   - Details: **Gruppentraining** (fester Termin, z. B. Ausfahrt mit Sportart und grober Intensität; der Coach plant drumherum)
   - **Auch für andere Tage übernehmen:** Wochentage zum Antippen (eigene Idee, spart Klicks)
2. „Welche Sportarten?“ Die Sportarten aus B3, je mit den Optionen aus Abschnitt 3 (Freiwasser, Rolle/draußen, Equipment) → **Speichern**

Darunter, für die ganze Woche:
- Maximale Stunden pro Woche (Vorgabe: Summe der Zeitfenster, deckelbar)
- Bevorzugter Ruhetag, Tag für die lange Einheit
- Hinweis, falls die Zeitfenster für das Event zu knapp sind („Für eine Langdistanz empfehle ich mindestens 8 h/Woche, du hast 6 h eingetragen.“)

Einmalige Ausnahmen (Urlaub, Reise, Krankheit) gibt es nicht im Onboarding, sondern später unter Plan bzw. Einstellungen → Verfügbarkeiten.

### B6 Bereit
„Überprüfe deine Einstellungen und ich lege los.“
- **Bisherige Aktivität:** Typ, wöchentliches Volumen, Intervalle ja/nein
- **Enthaltene Sportarten:** Chips mit Primärmetrik
- **Verfügbarkeiten:** Wochenraster in Kurzform, Summe h/Woche
- **Zeitplan:** Zeitstrahl Plan startet → Events (mit Priorität, Untertyp, Distanz, Zielzeit, Sportart) → Plan endet
- Jeder Abschnitt hat „Ändern“ und springt zum Schritt zurück
- Button **„Los geht's“**

### B7 Plan wird erstellt
Fortschritt in Schritten: „Phasen festlegen … Woche 1 planen … Woche 2 … Woche 3 …“. Bei einem Fehler (Provider, Prüfregel) bleibt alles erhalten, es gibt eine klare Meldung und „Erneut versuchen“. Danach öffnet sich direkt **Plan**. Der Plan ist aktiv, und die Workouts der 3 Wochen stehen im Kalender.

## 7. Bereich Plan

**Kopf:** Name des A-Events, Countdown („41 Wochen“), Phasenleiste vom Start bis zum Event mit farbigen Phasen, Markierung „Heute“, B- und C-Events als kleine Punkte. Tippen auf eine Phase zeigt Zweck und Wochen.

**Wochenliste:**
- **Ausgearbeitete Wochen (3):** Karte je Woche mit Phase, Belastung oder Entlastung, Zielstunden, Zweck in einem Satz („Grundlage festigen, erste Sweetspot-Reize“) und Tagen mit Einheiten (Sportfarbe, Dauer, Name).
- **Vorgemerkte Wochen:** kompakte Zeile mit Phase und Zielstunden, „wird am So., 01.11. ausgearbeitet“.
- **Vergangene Wochen:** geplant vs. absolviert, einklappbar unter **Verlauf** (inkl. Kennzahlen und Check-in-Verlauf, früher „Rückblick“).

**Einheit antippen** → Detail: Struktur (Grafik), Ziele in der Primärmetrik, „Warum diese Einheit“, Verpflegungshinweis, Export zu Garmin. Aktionen:
- **Verschieben** (anderen Tag wählen; der Coach prüft gegen Verfügbarkeiten)
- **Tauschen** (Alternative mit gleichem Ziel, z. B. Rolle statt draußen oder Laufen statt Rad)
- **Auslassen**
- **Behalten** (früher „Fixieren“: bleibt bei Anpassungen unangetastet)

**Woche anpassen:** Gründe als Chips (Keine Zeit, Krank, Müde, Reise, Mehr Zeit als geplant, Anderes) und optional Freitext → Vorher/Nachher → **Übernehmen** oder **Verwerfen**.

**Ausnahme eintragen:** „Ich bin weg / habe weniger Zeit“ mit Zeitraum. Betroffene Wochen werden angepasst (Vorher/Nachher).

## 8. Bereich Heute

1. Check-in, solange offen (Ablauf und Ampel wie heute)
2. Ampel und Einordnung: „Woche 3 von 41 · Grundlage · Belastungswoche“
3. Heutige Einheit(en) mit Zweck. Bei Gelb oder Rot: **Heute anpassen** (kürzer, lockerer, Ruhetag, auf morgen schieben) und **Woche anpassen**
4. Ausblick: die nächsten 3 Tage
5. Hinweiskarte, wenn etwas ansteht: Wochenrückblick offen, Woche +3 neu geplant, Event in 7 Tagen

## 9. Wochenrückblick und Nachplanen

**Wochenrückblick** (am Sonntag als Karte in Heute, jederzeit auch aus dem Plan):
- Geplant vs. absolviert (Stunden, Einheiten, ausgelassene Einheiten)
- „Wie anstrengend war die Woche?“ (1–5)
- „Was war los?“ Chips: Alles nach Plan, Wenig Zeit, Krank, Verletzt, Müde, Reise
- Absenden

**Nachplanen** (Einstellung „Coach-Verhalten“, der Nutzer wählt):
- **Nach meinem Wochenrückblick** (Vorgabe): Woche +3 wird ausgearbeitet, sobald der Rückblick abgeschickt ist. Fehlt der Rückblick bis Montag 06:00, plant der Coach ohne ihn.
- **Automatisch Sonntagabend**: ohne auf den Rückblick zu warten
- **Nur auf Knopfdruck**: „Nächste Woche planen“ im Plan

Ergebnis: Die neue Woche erscheint direkt (aktiv) mit einem Hinweis „Woche 4 geplant – 8,5 h, Fokus Sweetspot“. Weicht die abgelaufene Woche stark ab (krank, deutlich weniger), passt der Coach auch die bereits ausgearbeiteten Wochen 2–3 an und zeigt das als Vorher/Nachher.

## 10. Einstellungen

Gleiche Editoren wie im Onboarding, einzeln erreichbar:
- Athletenprofil (Sportarten, Gewicht, Alter)
- Leistungsdaten (FTP, Schwellenpace, CSS, max. HF, mit Herkunft)
- Verfügbarkeiten (Wochenraster und Ausnahmen)
- Events & Ziele (Liste, hinzufügen, Priorität ändern)
- Datenquellen
- AI-Provider
- Coach-Verhalten (Nachplanen, Morgen-Check-in an/aus)
- Plan neu erstellen / Plan beenden

**Änderungen mit Auswirkung auf den Plan** (Verfügbarkeiten, Events, Leistungsdaten, Sportarten) fragen nach dem Speichern: „Soll ich deinen Plan daran anpassen?“ → Vorher/Nachher der ausgearbeiteten Wochen und ggf. neue Phasenleiste. „Später“ ist möglich; der Plan zeigt dann einen Hinweis.

## 11. Lebenszyklus des Plans

| Situation | Verhalten |
| --- | --- |
| Neues A-Event | Phasen werden neu berechnet (Nachfrage mit Vorher/Nachher). |
| Neues B- oder C-Event | Nur die betroffenen Wochen ändern sich. Vorgemerkte Wochen werden markiert. |
| Event verschoben oder gelöscht | Wie neues Event. |
| Länger krank oder Pause | Wochenrückblick „Krank“ → Coach plant Wiedereinstieg und verschiebt Phasen. |
| A-Event vorbei | Erholungswoche, danach Karte „Wie geht's weiter?“ → Plan neu erstellen (Wizard vorausgefüllt) oder nächstes A-Event. |
| Mehrere A-Events | Der Plan endet mit dem letzten A-Event. Zwischen A-Events plant der Coach Taper, Erholung und Wiederaufbau. |

## 12. Was vom heutigen Coach wegfällt bzw. umzieht

| Heute | Künftig |
| --- | --- |
| Tabs Woche, Saison | Bereich Plan |
| Tab Rückblick | Plan → Verlauf |
| Tabs Athletenprofil, AI Provider | Einstellungen und Onboarding Teil A |
| Trainingsblock anlegen, Blocktypen, „Schlag mir was vor / Ich weiß, was ich will“ | entfällt; Phasen entstehen beim Plan erstellen |
| Saisonplan mit 2–3 Optionen, Editor, „Wochen angleichen“, „Block N von M“ | entfällt; Phasenleiste als Anzeige |
| Vorschlag prüfen & übernehmen beim ersten Plan | entfällt; „Los geht's“ ist die Bestätigung |
| Vorher/Nachher bei Wochenänderungen | bleibt |
| Fixieren | heißt „Behalten“ |
| Morgen-Check-in, Ampel, Beschwerden | bleibt unverändert |
| Wochenabschluss | wird Wochenrückblick mit Nachplanen |

## 13. Auswirkungen auf Backend und Daten (grob)

- **Sportarten:** neue Templates für Swim, XC Ski, Hyrox, Kraft mit Equipment und Koppeleinheiten (Bike→Run) für Tri und Duathlon. Garmin-Export für Swim und Strength prüfen.
- **Events:** eigenes Modell statt eines Zieldatums im Profil: Sportart, Untertyp, Start/Ende, Priorität, Umgang bei B/C, Distanz (bis 10.000 km), Zeit (Tage möglich), Höhenmeter, Ort.
- **Verfügbarkeiten:** Zeitfenster pro Wochentag mit Sportarten und Optionen, Gruppentraining, Ausnahmen statt Minuten pro Tag. Die heutigen Overrides werden zu Ausnahmen.
- **Planerstellung in einem Durchgang:** Phasen (aus den bestehenden Blockregeln) und 3 ausgearbeitete Wochen, direkt gespeichert.
- **Rollierendes Nachplanen:** Job bzw. Auslöser je nach Einstellung, plant Woche +3.
- **Primärmetrik pro Sportart** steuert die Ziele der Templates.
- **Migration:** bestehende Blöcke und Saisonpläne werden zu Phasen eines Plans; vorhandene Wochen und Workouts bleiben.

## 14. Offene Fragen

1. **Planlänge:** MATS begrenzt auf 1 Jahr. Sollen wir länger erlauben (heute bis 104 Wochen)?
2. **Primärmetrik Laufen:** Pace als Vorgabe, oder HF wie bisher?
3. **Leistungstest:** Wenn FTP, Schwellenpace oder CSS fehlen, Test in Woche 1 einplanen oder aus Daten schätzen und später nachschärfen?
4. **Ohne Event und ohne Datenquelle:** Reicht „Ziel ohne Event“ plus Zeitraum, oder geben wir eine Standardlänge vor (z. B. 12 Wochen)?
5. **Reihenfolge der Umsetzung:** zuerst Onboarding und Plan für die heutigen Sportarten (Bike, Run, Kraft) und danach die neuen Sportarten, oder alles zusammen?
