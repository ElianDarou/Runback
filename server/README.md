# Eigener Runback-Server

Eine Person, ein Telefon, eine lesende Website. Das Telefon sendet eine
freigegebene Kopie; der Server ändert keine Trainingsdaten, Pläne oder
Empfehlungen. Rohsamples, Originaldateien und Zugangsschlüssel bleiben auf dem
Telefon. Der Server ersetzt deshalb kein vollständiges App-Backup.

## Starten

Im Repository:

```sh
cd server
cp .env.example .env
docker compose up -d --build
docker compose logs runback
```

Öffne `http://DEINE-NAS-ADRESSE:8080`. Ohne `RUNBACK_PASSWORD` steht das erste
Passwort einmal im Log. Ändere es auf der Website unter „Daten“. Ein gesetztes
`RUNBACK_PASSWORD` überschreibt die Änderung beim Neustart.

Für eine eigene öffentliche Domain nutze einen HTTPS-Reverse-Proxy, etwa die
Konfiguration in `Caddyfile.example`. Binde Runback dann mit
`RUNBACK_BIND=127.0.0.1` nur an den lokalen Proxy und setze
`RUNBACK_TRUST_PROXY=1`. Der Proxy muss Forwarded-Header selbst setzen.

## Telefon verbinden

1. Melde dich auf der Website an und erzeuge unter „Daten“ einen Kopplungscode.
2. Öffne in der App „Einstellungen › Eigener Server“.
3. Trage die Adresse und den achtstelligen Code ein und wähle die Datenarten.
4. Tippe „Server verbinden“.

Im Heimnetz sind `nas.local:8080` und `http://192.168.1.20:8080` erlaubt.
Außerhalb des Heimnetzes verlangt die App HTTPS. Adressen mit Pfad werden
nicht unterstützt. Ein neuer Kopplungscode ersetzt das vorherige Telefon.

Bei offener App versucht Runback den Abgleich etwa jede Minute, außerhalb
eines laufenden Trainings. Im Hintergrund plant Android ihn mindestens alle
15 Minuten bei vorhandener Netzwerkverbindung; Energiesparregeln können ihn
verschieben. Unterwegs ohne Heimnetz signalisiert ein roter Punkt den
Verbindungsfehler. Die App bleibt voll benutzbar. Nach Wiederverbindung folgt
der vollständige Abgleich. Bereits übertragene Pakete müssen nicht erneut
übertragen werden; Website und API behalten bis dahin den letzten vollständig
bestätigten Stand.

GPS und Gesundheitswerte sind standardmäßig aus. Abgewählte und lokal gelöschte
Daten verschwinden beim nächsten vollständigen Abgleich vom Server. Beim
Trennen bleibt die Serverkopie erhalten; löschen kannst du sie auf der Website
unter „Daten“. Kopie löschen trennt auch das Telefon.

## API und Datenbank

Erzeuge unter „Daten“ einen Lese-Token. Sende ihn als
`Authorization: Bearer DEIN_TOKEN`. Die API liegt unter `/api/v1`;
die Beschreibung unter `/api/v1/openapi.json`.

```sh
curl -H 'Authorization: Bearer DEIN_TOKEN' https://runback.deine-domain.de/api/v1/runs
curl -H 'Authorization: Bearer DEIN_TOKEN' -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT start_utc, distance_m FROM v1_runs ORDER BY start_utc"}' \
  https://runback.deine-domain.de/api/v1/sql
```

SQL erlaubt ausschließlich lesende Abfragen auf `v1_runs`,
`v1_strength_sessions`, `v1_strength_sets`, `v1_wellness` und
`v1_recommendations` und `v1_documents`. Die Dokument-Sicht enthält die
freigegebenen Inhalte einschließlich Plänen, Vorlagen und Muskelkatermeldungen;
mit `json_extract` und `json_each` kannst du sie auswerten. Zugangsdaten und interne Tabellen sind gesperrt.
Abfragen enden nach fünf Sekunden und liefern höchstens 5.000 Zeilen.
Jede Sicht gibt `row_version` zurück. Neue Modelle ändern keine bereits
übertragenen Bewertungen oder Empfehlungsregeln.

Die Website bietet CSV, JSONL und einen SQLite-Download ohne Zugangsdaten.
Für eigene Werkzeuge nutze die API oder diese Downloadkopie, statt die laufende
Datenbank zu öffnen. Das Docker-Volume `runback-data` enthält die persistente
Datenbank. Ein Volume-Backup enthält auch Zugangsdaten und gehört in deinen
geschützten Speicher. Entferne das Volume nur, wenn du alle Serverdaten löschen
willst.

## Lokal entwickeln und prüfen

Node ab 24.21:

```sh
npm ci
npm run typecheck
npm test
RUNBACK_DATA_DIR=./data npm run dev
npm run build
```

Die Website übernimmt die Design-Token der App und nutzt deren versionierte
Auswertungslogik für Statistiken. Sie zeigt Empfehlungen aus der App und
erzeugt keine neuen.
