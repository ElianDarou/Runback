# Own Runback server

One person, one phone, one read-only website. The phone sends a shared copy;
the server changes no training data, plans or recommendations. Raw samples,
original files and access keys stay on the phone. The server is therefore not
a complete app backup.

## Start

From the repository:

```sh
cd server
cp .env.example .env
docker compose up -d --build
docker compose logs runback
```

Open `http://YOUR-NAS-ADDRESS:8080`. Without `RUNBACK_PASSWORD`, the first
password is printed once in the log. Change it on the website under “Data”. A
set `RUNBACK_PASSWORD` overrides the change on restart.

For your own public domain, use an HTTPS reverse proxy, for example the setup
in `Caddyfile.example`. Then bind Runback with `RUNBACK_BIND=127.0.0.1` to the
local proxy only, and set `RUNBACK_TRUST_PROXY=1`. The proxy must set the
forwarded headers itself.

## Language

The website is in German by default. Add `?lang=en` to any address for English,
or set your browser's language to English. An explicit `?lang=` wins over the
browser setting and is kept when you navigate. Old German addresses such as
`/verlauf` or `/daten` redirect to the English ones (`/history`, `/data`).

## Connect the phone

1. Sign in to the website and create a pairing code under “Data”.
2. In the app, open “Settings › Own server”.
3. Enter the address and the eight-digit code, and choose the kinds of data.
4. Tap “Connect server”.

On your home network, `nas.local:8080` and `http://192.168.1.20:8080` are
allowed. Outside your home network, the app requires HTTPS. Addresses with a
path are not supported. A new pairing code replaces the previously paired phone.

While the app is open, Runback tries to sync about every minute, outside a
running workout. In the background, Android schedules a sync at least every 15
minutes when a network connection is available; power-saving rules can delay
it. Away from your home network, a red dot signals the connection error. The
app stays fully usable. After reconnecting, the full sync follows. Packets that
were already transferred do not need to be sent again; until then, the website
and API keep the last fully confirmed state.

GPS and health values are off by default. Deselected and locally deleted data
disappears from the server at the next full sync. Disconnecting keeps the
server copy; you can delete it on the website under “Data”. Deleting the copy
also disconnects the phone.

## API and database

Create a read token under “Data”. Send it as
`Authorization: Bearer YOUR_TOKEN`. The API lives under `/api/v1`; its
description is at `/api/v1/openapi.json`.

```sh
curl -H 'Authorization: Bearer YOUR_TOKEN' https://runback.your-domain.example/api/v1/runs
curl -H 'Authorization: Bearer YOUR_TOKEN' -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT start_utc, distance_m FROM v1_runs ORDER BY start_utc"}' \
  https://runback.your-domain.example/api/v1/sql
```

SQL allows only read queries on `v1_runs`, `v1_strength_sessions`,
`v1_strength_sets`, `v1_wellness`, `v1_recommendations` and `v1_documents`. The
document view contains the shared content, including plans, templates and
soreness reports; you can evaluate it with `json_extract` and `json_each`.
Credentials and internal tables are blocked. Queries end after five seconds and
return at most 5,000 rows. Every view returns `row_version`. New models do not
change assessments or recommendation rules that were already transferred.

The website offers CSV, JSONL and a SQLite download without credentials. For
your own tools, use the API or this download copy instead of opening the live
database. The Docker volume `runback-data` holds the persistent database. A
volume backup also contains credentials, so keep it in protected storage.
Remove the volume only if you want to delete all server data.

## Develop and check locally

Node 24.21 or later:

```sh
npm ci
npm run typecheck
npm test
RUNBACK_DATA_DIR=./data npm run dev
npm run build
```

The website uses the app's design tokens and its versioned evaluation logic for
statistics. It shows recommendations from the app and creates no new ones.
