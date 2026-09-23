# USB-Terminexport: Prüfung für Garmin Edge 1050

Stand: 23.09.2026. Ergebnis: Das FIT-Format bietet einen passenden Mechanismus.
Der tatsächliche Kalenderimport auf dem Edge 1050 ist noch **nicht am Gerät bestätigt**.
Auf Wunsch des Nutzers wird stattdessen das Trainingsdatum dem Workout-Namen beim normalen FIT-Export vorangestellt (z. B. `24.09.2026 · 30 min konstant`). So lässt sich das passende Workout in der Bibliothek auswählen. Das Schedule-Experiment wird vorerst nicht weiterverfolgt.

## Rückmeldung vom Edge 1050

Der Nutzer sieht **TrainHub USB 24.09.** als Rad-Workout mit **5:00** in der Workout-Bibliothek. Damit ist der Workout-Import am Gerät bestätigt. Im Kalender für den 24.09. steht ein bereits vorhandenes, separates Schwellentraining; dieses ist nicht unser Testworkout. Der Nutzer hat bestätigt, beide Dateien übertragen und das Gerät danach getrennt zu haben. Das Testworkout erscheint weiterhin nur in der Bibliothek. Die Ursache ist ungeklärt; daraus folgt keine allgemeine Aussage zur USB-Terminunterstützung des Edge 1050.

## Belegt

- Der Edge 1050 hat einen Trainingskalender mit tagesbezogenen Workouts und unterstützt USB-Dateitransfer.
- Die FIT-Spezifikation beschreibt eine separate Datei vom Typ `schedules` (7) mit `schedule`-Nachrichten (28).
- Jede Nachricht verweist über `manufacturer`, `product`, `serial_number` und `time_created` auf die exakte Workout-Datei.
- `scheduled_time` ist eine **lokale** Datums-/Zeitangabe. Das Erstellungsdatum der Workout-Datei ist kein geplanter Trainingstag.
- Der installierte offizielle Garmin Python SDK 21.217.0 enthält diese Nachrichten und Felder weiterhin.

## Experiment

`backend/workout_schedule_probe.py` erstellt offline ein ZIP mit einem fünfminütigen Rad-Workout ohne Leistungsziel, einer dazu passenden Schedule-Datei, einer Anleitung und einem Prüfbericht. Die Dateien entstehen mit dem offiziellen SDK und werden mit SDK und fitparse einschließlich CRC erneut gelesen. Es gibt keinen Zugriff auf Garmin-Konten, angeschlossene Geräte oder die TrainHub-Datenbank und keine neue Abhängigkeit.

Beispiel aus `backend` (Zieldatei muss neu sein):

```powershell
.venv/Scripts/python.exe workout_schedule_probe.py --date 2026-09-24 --output ../artifacts/garmin-usb-test-2026-09-24.zip
.venv/Scripts/python.exe -m unittest -v test_workout_schedule_probe test_workout_export
```

Zuerst das Workout in `GARMIN/NewFiles` importieren und seine Sichtbarkeit im Trainingsmenü prüfen. Danach die zugehörige Schedule-Datei über denselben Eingang testen. Diese zweite Verarbeitung ist eine **zu prüfende Annahme**, keine zugesicherte Geräteeigenschaft. Die genaue Anleitung liegt im ZIP.

Vorher vorhandene Trainings- und Schedule-Dateien sichern: Ob die Firmware einen importierten Termin ergänzt, ignoriert oder einen bisherigen Zeitplan ersetzt, ist ungeprüft. Keine vorhandene `schedule.fit` oder Coach-Datei manuell ersetzen. Bei fehlendem Kalendereintrag nicht in weitere Systemordner kopieren.

## Erfolgskriterien und offene Punkte

1. Das Testworkout erscheint im Trainingsmenü mit einem Schritt von fünf Minuten.
2. Es erscheint unter **Training → Kalender → gewählter Tag**; die Schritte lassen sich öffnen.
3. Datum und Eintrag bleiben nach einem Neustart erhalten.
4. Anschließend prüfen, ob Garmin-Connect-Synchronisierung den lokalen Termin erhält oder ersetzt.
5. Vorhandene geplante Trainings bleiben verfügbar.

Modell und Firmware sowie jeden dieser Punkte dokumentieren. Ein erfolgreicher USB-Import belegt keinen Upload des Termins zu Garmin Connect. Für die vollständige Plattformfunktion wären anschließend ein als zusammengehörig exportiertes Dateipaar und die Behandlung erneuter Exporte, Datumsänderungen und mehrerer Termine nötig.

## Quellen

- [Garmin Edge 1050: Trainingspläne und Kalender](https://www8.garmin.com/manuals/webhelp/GUID-08ACA9FC-DEE6-4C8D-8A95-F62181C512E9/EN-US/GUID-7C681AA6-5A65-457A-9012-7142DA3C3708.html)
- [Garmin Edge 1050: USB-Dateitransfer](https://www8.garmin.com/manuals/webhelp/GUID-08ACA9FC-DEE6-4C8D-8A95-F62181C512E9/EN-US/GUID-50017E96-C40C-471D-BE61-3A0C09E93916.html)
- [FIT File Types, Dynastream, Revision 2.2, Kapitel 14, S. 70–72](https://help.locusmap.eu/attachments/7598) (Herstellerdokument von 2017, auf einer Drittseite archiviert; keine aktuelle Edge-Kompatibilitätszusage)
- [Offizielles Garmin SDK: aktuelles FIT-Profil](https://github.com/garmin/fit-python-sdk/blob/main/garmin_fit_sdk/profile.py)

Die offiziellen Edge-Anleitungen beschreiben Garmin-Connect-Termine und allgemeinen Dateitransfer. Sie bestätigen nicht ausdrücklich den Import selbst erzeugter Schedule-Dateien über USB. Genau diese Lücke prüft das Testpaket.
