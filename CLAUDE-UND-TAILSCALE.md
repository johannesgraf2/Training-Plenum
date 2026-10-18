# Claude & Fernzugriff (Tailscale, MCP)

Training Plēnum lässt sich von unterwegs öffnen und mit Claude verbinden, ohne dass die App selbst im Internet steht:

- **Von unterwegs:** [Tailscale](https://tailscale.com) verbindet Rechner und Handy zu einem privaten Netz (Tailnet). Training Plēnum ist dann unter `https://<rechner>.<tailnet>.ts.net` erreichbar, mit gültigem Zertifikat, aber nur für deine eigenen Geräte.
- **Claude:** Training Plēnum ist ein [MCP-Server](https://modelcontextprotocol.io). Claude liest darüber Aktivitäten, Umfang, Fitness, Bestwerte, geplante Einheiten und WHOOP-Erholung und plant auf Wunsch Einheiten in den Kalender.

Alles Nötige steht in der App: Menü oben rechts (dein Name) → **Claude & Fernzugriff**. Dort siehst du, ob Tailscale läuft und was freigegeben ist. Die Befehle und Adressen zum Kopieren stehen ebenfalls dort.

## 1. Von unterwegs öffnen

1. Tailscale auf dem Rechner mit Training Plēnum und auf dem Handy installieren und mit **demselben Konto** anmelden ([Download](https://tailscale.com/download)).
2. Auf dem Rechner einmalig im Terminal (Windows: PowerShell):

   | Training Plēnum läuft als | Befehl |
   |---|---|
   | Windows-App | `tailscale serve --bg 5000` |
   | Docker (`docker-compose.yml`) | `tailscale serve --bg 80` |

   Beim ersten Mal fragt Tailscale, ob HTTPS-Zertifikate für dein Tailnet eingeschaltet werden sollen: dem Link folgen und zustimmen. Die Freigabe überdauert Neustarts. Abschalten: `tailscale serve --https=443 off`.
3. Auf dem Handy in der Tailscale-App verbinden und `https://<rechner>.<tailnet>.ts.net` im Browser öffnen. Die genaue Adresse steht im Dialog.

`tailscale serve` macht die App **nur im Tailnet** sichtbar. Alle Geräte und Personen in deinem Tailnet haben vollen Zugriff, denn Training Plēnum hat keine eigene Anmeldung. Teile den Rechner deshalb nicht mit fremden Tailnets.

Mit `start-local.ps1` oder `npm start` liefern Seite und API zwei verschiedene Ports. Für den Zugriff von unterwegs deshalb die Windows-App oder Docker nehmen.

## 2. Claude verbinden

Zuerst im Dialog wählen, was Claude darf:

- **Nur lesen** (Standard): Überblick, Aktivitäten, Wochenumfang & Fitness, Bestwerte, geplante Einheiten, der heutige Tag aus Sicht des AI Coachs, WHOOP-Erholung.
- **Lesen und Einheiten planen**: zusätzlich Workouts anlegen, ändern und löschen. Sie landen im Kalender und, wenn Garmin Connect verbunden ist, im Garmin-Kalender. Gesperrte Einheiten bleiben unangetastet.

Je nach Claude-Programm gibt es zwei Wege:

| Programm | Verbindet sich von | Anmeldung | Erreicht |
|---|---|---|---|
| Claude Code | deinem Gerät | persönliches Token | lokal oder über das Tailnet |
| Claude Desktop mit Konfigurationsdatei | deinem Gerät | persönliches Token | lokal oder über das Tailnet |
| claude.ai, Claude-App (Handy), Connectors in Claude Desktop | der Cloud von Anthropic | Freigabe mit Code (OAuth) | nur über Tailscale Funnel |

### Claude Code und Claude Desktop (Token)

Im Dialog **Token erzeugen**. Das Token wird nur einmal angezeigt, gespeichert wird nur sein Hash. Der Dialog zeigt die fertigen Befehle, wahlweise für diesen Rechner (`http://127.0.0.1:5000`) oder für ein anderes Gerät im Tailnet.

**Claude Code:**

```bash
claude mcp add --transport http training-plenum https://<rechner>.<tailnet>.ts.net/mcp --header "Authorization: Bearer <TOKEN>"
```

**Claude Desktop** (Einstellungen → Entwickler → Konfiguration bearbeiten, also `claude_desktop_config.json`; braucht [Node.js](https://nodejs.org)):

```json
{
  "mcpServers": {
    "training-plenum": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:5000/mcp", "--header", "Authorization:${AUTH}"],
      "env": { "AUTH": "Bearer <TOKEN>" }
    }
  }
}
```

Danach Claude Desktop neu starten. Ein neues Token macht das alte ungültig; **Token löschen** sperrt beide Programme aus.

### claude.ai, Claude-App und Connectors (Freigabe)

Diese Apps verbinden sich aus der Cloud von Anthropic und erreichen dein Tailnet nicht. Dafür gibt es einen eigenen **Claude-Port (5001)**: Er beantwortet ausschließlich `/mcp` und die OAuth-Anmeldung, alles andere gibt es dort nicht. Nur er kommt per Tailscale Funnel ins Internet.

1. Einmalig im Terminal:

   ```bash
   tailscale funnel --bg --https=8443 5001
   ```

   Ist Funnel in deinem Tailnet noch aus, zeigt Tailscale einen Link zum Einschalten. Abschalten: `tailscale funnel --https=8443 off`.
2. In Claude unter **Einstellungen → Connectors → Eigenen Connector hinzufügen** die Adresse `https://<rechner>.<tailnet>.ts.net:8443/mcp` eintragen. Weitere Felder bleiben leer.
3. Beim Verbinden öffnet Claude die Freigabeseite von Training Plēnum. Sie fragt nach einem **Freigabecode**: im Dialog **Freigabecode erzeugen**, den Code eintippen und **Erlauben**. Der Code gilt 10 Minuten und nur einmal; nach 5 falschen Versuchen ist er verbraucht.

Der Connector gilt dann für claude.ai, die Desktop-App und das Handy. Verbundene Apps stehen im Dialog und lassen sich dort einzeln **trennen**. Die Anmeldung erneuert sich selbst: Zugriffstokens gelten eine Stunde, das Erneuerungstoken 60 Tage und wird bei jeder Erneuerung ersetzt.

## Was Claude sieht

| Werkzeug | Inhalt |
|---|---|
| `get_training_overview` | Profil (FTP, HFmax, Gewicht), Umfang und Intensität der letzten 7/28/42 Tage, 365-Tage-Verlauf, Bestwerte, Ziele, Wettkämpfe, Verfügbarkeit, Beschwerden, Check-ins der letzten 14 Tage |
| `list_activities` | Aktivitäten mit Dauer, Distanz, Puls, Leistung, Höhenmetern und Notizen |
| `get_activity` | Runden, Normalized Power, TSS, Minuten je Zone, auf Wunsch der gemittelte Verlauf (Puls, Leistung, Tempo, Kadenz, Höhe) |
| `get_training_load` | Wochenumfang, TSS, Zeit je Zone und Fitness (CTL) |
| `get_best_efforts` | Bestwerte Rad und Laufen |
| `list_planned_workouts`, `get_today` | Kalender, Tagesform-Ampel, Hinweise des AI Coachs |
| `get_recovery` | WHOOP: Schlaf, HRV, Ruhepuls, Readiness, Strain |
| `create_planned_workout`, `update_planned_workout`, `delete_planned_workout` | nur mit „Lesen und Einheiten planen“ |

**GPS-Positionen gehen nie an Claude**, auch nicht im Verlauf einer Aktivität. Originaldateien werden nicht übertragen. Was Claude abruft, verarbeitet Anthropic nach seinen Datenschutzbedingungen. Wer das nicht möchte, verbindet Claude nicht oder bleibt bei „Nur lesen“ und fragt gezielt.

## Sicherheit

- **Tailnet:** Die App lauscht weiter nur auf `127.0.0.1`. `tailscale serve` reicht sie verschlüsselt an deine Tailnet-Geräte weiter.
- **Funnel:** Nur der Claude-Port 5001 gehört ins Internet. Zusätzlich lehnt Training Plēnum jede Anfrage ab, die Tailscale als Funnel-Anfrage markiert (`Tailscale-Funnel-Request`) und die nicht zu MCP oder OAuth gehört. Das gilt auch dann, wenn versehentlich der App-Port per Funnel freigegeben wurde. Der Dialog warnt in diesem Fall und nennt den Befehl zum Abschalten.
- **Ursprungsprüfung:** Coach-, Garmin-, WHOOP- und Claude-Einstellungen beantworten Browser nur von `localhost`, von der per `tailscale status` erkannten Tailnet-Adresse dieses Rechners und von Adressen aus `TRAINHUB_REMOTE_URL`. Andere `*.ts.net`-Adressen werden nie akzeptiert, denn jedes Tailnet kann Seiten unter dieser Domain veröffentlichen.
- **Tokens:** Gespeichert werden nur SHA-256-Hashes. Die Anmeldung der Claude-Apps ist OAuth 2.1 mit Dynamic Client Registration und PKCE (S256), die Codes gelten einmal. Die Freigabeseite lässt sich nicht einbetten und zeigt, wohin sie zurückleitet.

## Docker

Der Container hat keine Tailscale-CLI und kann die Tailnet-Adresse deshalb nicht selbst erkennen. In `docker-compose.yml` beim Backend eintragen:

```yaml
- TRAINHUB_REMOTE_URL=https://<rechner>.<tailnet>.ts.net,https://<rechner>.<tailnet>.ts.net:8443
```

Tailscale läuft auf dem Host: `tailscale serve --bg 80` (nginx) und für Claudes Apps `tailscale funnel --bg --https=8443 5001`. Den Port 5001 bindet `docker-compose.yml` nur an `127.0.0.1` des Hosts.

## Einstellungen

| Variable | Standard | Bedeutung |
|---|---|---|
| `TRAINHUB_REMOTE_URL` | – | Zusätzliche erlaubte Adressen, kommagetrennt (z. B. die Tailnet-Adresse im Docker-Betrieb). `TRAINHUB_COACH_ORIGINS` gilt weiterhin. |
| `TRAINHUB_CLAUDE_PORT` | `5001` | Port nur für MCP und OAuth; `0` schaltet ihn ab. |
| `TRAINHUB_CLAUDE_HOST` | `127.0.0.1` | Adresse des Claude-Ports (im Container `0.0.0.0`). |
| `TRAINHUB_APP_PORT` | Windows-App `5000` | Port, der Seite und API gemeinsam liefert; nur für den Befehlsvorschlag im Dialog. |
| `TRAINHUB_TAILSCALE_CLI` | automatisch | Pfad zur Tailscale-CLI, falls sie nicht gefunden wird. |

## Fehlersuche

| Meldung | Ursache und Lösung |
|---|---|
| „Diese Adresse ist hier nicht freigegeben“ über die Tailnet-Adresse | Tailscale wurde nicht erkannt (Docker, ungewöhnlicher Installationsort). Im Dialog **Erneut prüfen** oder die Adresse in `TRAINHUB_REMOTE_URL` eintragen. |
| Claude: „Couldn't reach the MCP server“ | Funnel läuft nicht oder zeigt nicht auf Port 5001: `tailscale funnel status`. Die Adresse muss auf `:8443/mcp` enden. |
| „Der Claude-Port 5001 läuft nicht“ | Ein anderes Programm nutzt den Port. `TRAINHUB_CLAUDE_PORT` auf einen freien Port setzen und den Funnel-Befehl anpassen. |
| `tailscale serve` meldet „Access denied“ | Windows: PowerShell als Administrator starten. Linux: `sudo` voranstellen oder einmalig `sudo tailscale set --operator=$USER`. |
| Die Freigabeseite sagt „keinen gültigen Freigabecode“ | Der Code ist abgelaufen, verbraucht oder wurde 5-mal falsch eingegeben: einen neuen erzeugen. |
| Claude Desktop zeigt den Server nicht an | Node.js installiert? `npx -y mcp-remote …` einmal im Terminal starten; Fehler stehen dort und im Log von Claude Desktop. |

Technik: Der MCP-Endpunkt (`backend/mcp_server.py`) spricht Streamable HTTP ohne Sitzungen und beantwortet jede Anfrage als JSON. Die Werkzeuge lesen über die eigene API der App, mit denselben Prüfungen. Tailscale-Erkennung, Origin-Regeln und der Claude-Port stehen in `backend/remote_access.py`.
