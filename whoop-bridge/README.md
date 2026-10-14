# WHOOP-Bridge für Training Plēnum

Ein kleiner Hintergrunddienst für den Mac, auf dem Training Plēnum läuft. Er hält die Bluetooth-Verbindung zum **WHOOP 4.0**, holt die gespeicherten Verlaufsdaten vom Strap und schickt sie an Training Plēnum. Die Bridge hat **keine eigene Oberfläche**: Einrichtung, Status und alle Auswertungen findest du in Training Plēnum unter *Profil → WHOOP-Strap verbinden*.

Warum ein eigener Dienst? Docker auf macOS hat keinen Zugriff auf Bluetooth. Die Bridge läuft deshalb direkt auf dem Mac und spricht Training Plēnum per HTTP an.

## Voraussetzungen

- macOS mit Bluetooth
- Python 3.11 oder neuer (`brew install python@3.12` oder von python.org)
- Training Plēnum läuft (Docker oder nativ)
- WHOOP 4.0, getragen und geladen

## 1. Strap von der WHOOP-App trennen

Der Strap koppelt sich nur mit einem Gerät. In der WHOOP-App den Strap entfernen und am Handy Bluetooth ausschalten (oder das Handy außer Reichweite bringen). Danach erhalten WHOOP-App und WHOOP-Cloud keine Daten mehr.

## 2. Installieren und verbinden

In Training Plēnum *Profil → WHOOP-Strap verbinden → Token erzeugen* wählen. Dort stehen beide Befehle zum Kopieren bereit:

```bash
cd /Pfad/zu/Training-Plenum
bash whoop-bridge/install-mac.sh
~/.trainingplenum-whoop/venv/bin/python ~/.trainingplenum-whoop/app/bridge.py setup http://localhost:5000 <TOKEN>
```

`install-mac.sh` legt unter `~/.trainingplenum-whoop/` eine eigene Python-Umgebung mit [bleak](https://github.com/hbldh/bleak) an und richtet den LaunchAgent `com.trainingplenum.whoop-bridge` ein. `setup` prüft Adresse und Token, speichert beides in `~/.trainingplenum-whoop/config.json` (nur für dich lesbar), sucht einmal nach dem Strap und startet dann den Hintergrunddienst.

**Adresse:** dieselbe, unter der das Backend erreichbar ist. Mit dem `docker-compose.yml` aus diesem Repo ist das `http://localhost:5000` (oder `http://localhost` über nginx). Läuft Training Plēnum unter einem anderen Hostnamen, muss dessen Ursprung in `TRAINHUB_COACH_ORIGINS` stehen.

### Bluetooth-Berechtigung

Beim ersten `setup` fragt macOS, ob das Terminal Bluetooth verwenden darf: erlauben. Der Hintergrunddienst läuft danach über launchd. Falls im Log steht, dass Bluetooth nicht erlaubt ist:

1. *Systemeinstellungen → Datenschutz & Sicherheit → Bluetooth* öffnen und Python bzw. das Terminal erlauben.
2. Dienst neu starten: `bash whoop-bridge/install-mac.sh`
3. Hilft das nicht, die Bridge als Anmeldeobjekt im Terminal starten: `~/.trainingplenum-whoop/venv/bin/python ~/.trainingplenum-whoop/app/bridge.py run`

## Status und Fehlersuche

| Befehl | Zeigt |
|---|---|
| `tail -f ~/.trainingplenum-whoop/bridge.log` | laufendes Log |
| `…/bridge.py status` | letzter Zustand und Anzahl Frames im Puffer |
| `…/bridge.py scan` | WHOOP-Straps in Reichweite |
| `…/bridge.py -v run` | Dienst im Vordergrund mit ausführlichem Log (vorher `install-mac.sh --uninstall`) |

**Aktualisieren:** nach einem `git pull` einfach `bash whoop-bridge/install-mac.sh` erneut ausführen.
**Entfernen:** `bash whoop-bridge/install-mac.sh --uninstall` (Konfiguration und Puffer bleiben in `~/.trainingplenum-whoop/`).

## Was die Bridge tut

1. Sucht den Strap (WHOOP-Dienst `61080001-…`), verbindet sich und abonniert Antworten, Ereignisse, Daten und die Standard-Herzfrequenz.
2. Einmal pro Verbindung: Akkustand abfragen (koppelt den Strap), Seriennummer und Firmware lesen, Uhrzeit setzen und zurücklesen, den Rohdaten-Stream abschalten.
3. Alle 15 Minuten, oder sofort wenn du in Training Plēnum *Jetzt synchronisieren* drückst: Verlaufsdaten abholen. Jeder Chunk wird **zuerst** im lokalen Puffer (`outbox.db`, SQLite) gespeichert und **erst danach** dem Strap bestätigt. Erst die Bestätigung erlaubt dem Strap, den Speicher freizugeben. Schlägt das Speichern fehl oder kommen 60 Sekunden keine Daten, bricht die Bridge ohne Bestätigung ab; der Strap liefert dieselben Daten beim nächsten Mal erneut.
4. Ein Upload-Task schickt den Puffer gzip-komprimiert an Training Plēnum. Frames werden erst nach einer erfolgreichen Antwort gelöscht. Ist Training Plēnum aus, sammelt die Bridge weiter.
5. Alle 30 Sekunden meldet sie ihren Zustand (Strap, Akku, Firmware, Puffer, letzter Sync).

Die Bridge dekodiert nichts selbst: Training Plēnum bekommt die Rohframes und dekodiert sie. Korrekturen am Decoder kommen deshalb mit Training Plēnum, ohne die Bridge neu zu installieren, und gelten über *Rohdaten neu einlesen* auch für die letzten 30 Tage.

**Nie gesendet:** Kommandos, die den Strap zurücksetzen, Kopplungen löschen, den Speicher ohne Bestätigung freigeben, den Lesezeiger verschieben oder Firmware laden. `whoop_protocol.build_command` verweigert sie grundsätzlich.

**Datenschutz:** Training Plēnum speichert vom Token nur einen Hash. Die Seriennummer des Straps wird nur gehasht gemeldet. Alle Daten bleiben auf deinem Mac.

**Grenzen:** Der Strap speichert nach bisherigem Wissen etwa 14 Tage. Ist die Bridge länger aus, gehen ältere Daten verloren; Training Plēnum warnt, wenn die Bridge mehr als 24 Stunden offline war.

## Erster Test mit dem echten Strap

1. Training Plēnum starten, Token erzeugen, `install-mac.sh` und `setup` ausführen.
2. In Training Plēnum unter *WHOOP* sollte nach spätestens einer Minute stehen: *Bridge online*, *Strap verbunden*, Akkustand, Firmware.
3. Nach dem ersten Offload: *Daten bis* nahe der aktuellen Uhrzeit, *Herzfrequenz ✓* und *R-R-Abstände ✓*.
4. Stehen dort *nicht dekodiert* oder eine Fehlermeldung zum Format, bleiben die Rohframes erhalten. Nach einer Decoder-Korrektur reicht *Rohdaten neu einlesen*.
5. *Echtzeit-HF* (Standard-Herzfrequenzprofil) mit der Herzfrequenz aus dem Verlauf vergleichen; beide sollten zur selben Zeit ähnlich sein.

## Tests

```bash
cd whoop-bridge && python3 -m unittest   # ohne Strap, ohne bleak, mit einem simulierten Strap
```

## Rechtliches

Eigener Code. Die Protokoll-Fakten (UUIDs, Frame-Aufbau, CRCs, Kommandonummern, Offsets) stammen aus der Dokumentation des Projekts [noop](https://github.com/ryanbr/noop), dessen Lizenz diese Fakten ausdrücklich freigibt. Von noop wird kein Code verwendet. Kein offizielles WHOOP-Produkt.
