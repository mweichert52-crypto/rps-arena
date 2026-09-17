# RPS Arena

Eine Echtzeit-Schere-Stein-Papier-Arena für zwei Spieler und beliebig viele Zuschauer. Das Projekt läuft als ein Node.js-Webservice und nutzt Socket.IO für die Live-Verbindung.

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm start
```

Öffne danach http://localhost:3000 in zwei Browserfenstern. Zum Testen von Zuschauern öffne ein drittes Fenster.

## Auf Render veröffentlichen

1. Öffne https://render.com und erstelle ein Konto.
2. Klicke **New +** → **Web Service**.
3. Verbinde dein GitHub-Konto und wähle `mweichert52-crypto/rps-arena`.
4. Einstellungen:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`
5. Klicke **Create Web Service**.

Render setzt automatisch die Umgebungsvariable `PORT`. Danach kannst du die angezeigte `onrender.com`-Adresse mit anderen Spielern teilen. Socket.IO läuft über dieselbe URL; es ist keine zweite Webseite nötig.

> Hinweis: Ein kostenloser Render-Service kann nach längerer Inaktivität pausieren. Für dauerhaft sofort verfügbare Spiele benötigst du einen aktiven/bezahlten Service. Räume liegen aktuell im Arbeitsspeicher und werden bei einem Neustart gelöscht.

## Spielregeln

Die Auswahl wird erst nach Auswahl + Ready beider Spieler und einem 3-Sekunden-Countdown veröffentlicht. Ein Match endet bei 3 gewonnenen Runden. Danach wird die Arena nach 10 Sekunden für neue Spieler freigegeben.
