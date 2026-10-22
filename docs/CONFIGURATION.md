# WatchSense configuration guide

[🇮🇹 Italiano](CONFIGURATION.it.md) · 🇬🇧 English · [Back to README](../README.md)

UI labels are quoted as they appear in the English UI (see [Language and region](#language-and-region) to switch the app to Italian). The settings page is **Settings** (gear icon). Its sections, in a sidebar on desktop and as a list on phones, are *General* (language, region, Home sections), *Viewing sources* (Netflix, Prime Video, Stremio, Trakt, CSV file), *Artificial intelligence* (LLM provider, taste profile), *Metadata (TMDB)*, *Access and security* and *System*. The open section is in the address (e.g. `/?section=sources&source=netflix`), so it can be bookmarked or linked.

- [TMDB](#tmdb)
- [LLM provider](#llm-provider)
- [Sync methods](#sync-methods)
- [Language and region](#language-and-region)
- [Access and security](#access-and-security)
- [Environment variables](#environment-variables)
- [Running as a systemd user service](#running-as-a-systemd-user-service)
- [Backup and restore](#backup-and-restore)
  - [Export your data](#export-your-data)
  - [Schema upgrades](#schema-upgrades)

## TMDB

A TMDB API key is required for metadata, posters and streaming availability. It is free.

1. Create an account on [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to **Settings → [API](https://www.themoviedb.org/settings/api)** and request a developer key.
3. Copy the **API Key (v3 auth)** (32 hexadecimal characters; the longer "API Read Access Token" is not supported) and add it in **Settings → Metadata (TMDB)**, or set it in the environment:

   ```bash
   TMDB_API_KEY=your_key
   ```

A key saved in Settings is stored in the database and **overrides** `TMDB_API_KEY`; it takes effect immediately, and **Test key** checks it against TMDB. Removing it from Settings falls back to `TMDB_API_KEY` (if set). After changing the environment variable, restart the app.

For the environment variable, put it in the root `.env` (loaded at startup, see [where variables are read from](#environment-variables)) or in the service environment. `.secrets/tmdb.key` is no longer read.

TMDB language and region come from [Language and region](#language-and-region).

## LLM provider

WatchSense works with any **OpenAI-compatible** endpoint (`/chat/completions` and, optionally, `/models`). The base URL may or may not end with `/v1`: `/v1` is appended when missing.

### Where the configuration comes from

1. Values saved in **Settings → Artificial intelligence → LLM provider** (stored in the database) take priority.
2. Otherwise environment variables are used, in this order:
   - `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`;
   - legacy fallback `KILO_API_KEY` / `KILO_BASE_URL` (default base URL `https://api.kilo.ai/api/gateway`);
   - legacy fallback `OPENROUTER_API_KEY`, always sent to `https://openrouter.ai/api/v1` only.

If you save a base URL in the UI without a key, the environment key is used only when it belongs to the same base URL. Changing provider in the UI clears the previously saved key, so a key is never sent to a different provider.

### Presets

The **Provider** dropdown in *LLM provider* fills in the base URL (shown under *Advanced settings (base URL)*):

| Preset | Base URL | API key |
| :--- | :--- | :--- |
| Kilo Gateway | `https://api.kilo.ai/api/gateway` | required |
| OpenRouter | `https://openrouter.ai/api/v1` | required |
| OpenAI | `https://api.openai.com/v1` | required |
| Groq | `https://api.groq.com/openai/v1` | required |
| DeepSeek | `https://api.deepseek.com/v1` | required |
| Mistral | `https://api.mistral.ai/v1` | required |
| Ollama (local) | `http://localhost:11434/v1` | optional |
| LM Studio (local) | `http://localhost:1234/v1` | optional |
| Custom | any URL | depends |

The API key is optional for local addresses: `localhost`, `127.x`, `::1`, private ranges (`10.x`, `172.16–31.x`, `192.168.x`), `*.local`, Tailscale `100.64.0.0/10` and `host.docker.internal`. A remote base URL without a key is rejected.

Use **Load models from the provider** to fill the model dropdown from `{base}/models`, or type any name in *Model name*. **Test connection** sends a test request.

### Model

The default model is `kilo-auto/free`, which **only exists on Kilo**. With any other provider set `LLM_MODEL` or pick a model in the UI.

Example (`.env`):

```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=deepseek/deepseek-chat
```

### Local model (Ollama, LM Studio)

```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:14b
```

If Ollama runs on the host and WatchSense in Docker, `localhost` is the container itself. Use instead:

```bash
LLM_BASE_URL=http://host.docker.internal:11434/v1
```

On Linux with Docker Engine, `host.docker.internal` is not defined by default (Docker Desktop defines it): uncomment these lines in `docker-compose.yml`:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Ollama must also listen on an address reachable from the container (e.g. `OLLAMA_HOST=0.0.0.0`).

## Sync methods

| Source | Method | Automatic |
| :--- | :--- | :--- |
| Netflix | session cookies saved in settings | yes, every 6, 12 or 24 hours (default 12) |
| Netflix, Prime Video | bookmarklet | no, click it on the history page |
| Stremio | sign-in with email and password (or an authKey) | yes, daily |
| Trakt | data export in `exports/trakt/` | no, **Import from Trakt** button |
| Netflix, Prime Video | CSV upload | no |

Prime Video has no automatic sync: the bookmarklet is the only "live" method, the CSV upload is the alternative.

WatchSense is built for TV series: films found in the histories are stored but neither shown nor used for recommendations.

### Netflix: session cookies

1. Log in to netflix.com in your browser.
2. Copy the `NetflixId` and `SecureNetflixId` cookies (browser DevTools → Storage/Application → Cookies, or a cookie-export extension such as Cookie-Editor).
3. Paste them in *Viewing sources → Netflix → Connection* and click **Save and test**: the cookies are saved and a test sync runs at once, with the result shown in the panel. Accepted formats: `NetflixId=...; SecureNetflixId=...`, the **Header String** exported by Cookie-Editor (all the cookies of the site, pasted as they are), a JSON export (array or object), or one cookie per line.
4. **Sync now** runs a sync at any time.

**Sync interval.** *Check every* in the Netflix panel sets the interval: 6, 12 or 24 hours (if `SYNC_INTERVAL_HOURS` is set to another value, that value is offered too). Precedence: the value chosen in Settings (`config.netflix_sync_interval_hours`) → `SYNC_INTERVAL_HOURS` → 12. The background scheduler checks every hour (first check 30 seconds after startup) and syncs Netflix when the interval has passed since the last run; it reads the interval at every check, so a change applies without a restart. The panel shows the last sync, its result and the next expected run. Via the API: `POST /api/config` with `{"netflix": {"sync_interval_hours": 6}}` (other values are rejected with `400`; `null` goes back to the environment/default).

**The 20-item limit.** Each sync reads the Netflix viewing-activity page, which returns only the **latest 20 entries**. If you watch more than 20 episodes between two syncs, the older ones are missed. Choose a shorter interval if you binge-watch, and use the CSV upload to import the full history once.

**Expired cookies.** When Netflix rejects the cookies (401, 403 or a redirect to the login page), the last sync is marked as failed and the Netflix panel shows a red notice *"Netflix cookies expired: update them"*. Log in again and paste fresh cookies. Other failures (network errors, timeouts, other HTTP errors, a page that cannot be parsed) show a generic notice *"Last Netflix sync failed"* with the error, and the cookies are kept as they are.

### Bookmarklet (Netflix and Prime Video)

1. In *Viewing sources → Prime Video*, drag the **Sync WatchSense** button to the bookmarks bar, or use **Copy the code** and paste the code as the URL of a new bookmark.
2. Open the history page while logged in:
   - Prime Video: `https://www.primevideo.com/settings/watch-history`
   - Netflix: `https://www.netflix.com/viewingactivity`
3. Click the bookmark. The titles found in the page are sent to `/api/sync/ingest`.

**Prime Video: full history.** On Prime Video the bookmarklet loads the **whole** watch history, not only the entries inlined in the page: it scrolls the page automatically, reads the history data Prime Video loads while scrolling, and shows a progress notice (*Loading history… N views*). Then it removes duplicates and sends everything.
- Run it **right after opening** the history page, without scrolling first. If the page was already scrolled it asks whether to continue anyway (some entries may be missing) or stop, reload the page and run it again.
- Wait for it to finish and **leave the tab open** (a long history can take a minute or two; it stops after 5 minutes and asks whether to send what it found).
- More than 5000 entries are sent in blocks of 5000 (the `/api/sync/ingest` limit).
- The scrolling technique is ported from [Watch History Exporter for Amazon Prime Video](https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video) by John Goodliff ([@twocaretcat](https://github.com/twocaretcat)), released into the public domain under The Unlicense. Thanks!

Notes:
- The bookmarklet contains the WatchSense address you opened the settings page with: create it from the same URL your browser will use to reach the instance.
- On Netflix it reads only what is in the page data, typically the most recent entries.
- **HTTP vs HTTPS.** If you reach WatchSense over plain HTTP (e.g. `http://host:3333`), the browser blocks the background request from the `https://` history page (mixed content), so the bookmarklet submits a form in a **new tab**: it shows the import and then redirects to WatchSense. This is expected. On Prime Video the new tab can only be opened after a click (the browser blocks pop-ups once the scrolling is over), so the notice shows a **Send to WatchSense** button; with more than 5000 entries it shows **Send part 1/N**, one click (and one tab) per block. If the instance is served over HTTPS (e.g. behind `tailscale serve`), the data is sent in the background and a notice appears on the page.

**Ingest token.** Each instance has a random token (`config.ingest_token`, 32 bytes hex, created on first use) that the bookmarklet sends with every request; `/api/sync/ingest` rejects requests without a valid token with an error asking to reinstall the bookmarklet from Settings (*"Invalid bookmarklet token: reinstall the bookmarklet from Settings."*). This message, the other errors shown in the notice on the history page and the error page of the form fallback follow the app language set in Settings. The token is what authorizes the request, because the form fallback from an HTTPS page to an HTTP instance arrives with `Origin: null`. CORS headers are still sent only to Netflix, Prime Video and Amazon origins.

- Treat the bookmarklet code as a secret: anyone who has it can add entries to your history.
- **Regenerate token** (under *Bookmarklet security and details* in the Prime Video panel, or in *Access and security*) creates a new token. The old bookmarklet stops working: reinstall it from the settings page.
- The token is shown in the settings page: without [`WATCHSENSE_TOKEN`](#access-and-security) anyone who can open it can read it.

### Stremio

In *Viewing sources → Stremio → Connection*, enter the email and password of your Stremio account and click **Connect Stremio**. WatchSense signs in to `api.strem.io` (`POST /api/sync/stremio-login`) and stores **only the session key (authKey)** returned by Stremio: the password is never stored, logged or sent back to the browser. The first sync starts right after.

If you prefer not to type the password, open **I already have an authKey**:

1. Open [web.stremio.com](https://web.stremio.com) and log in.
2. Open the browser console (F12 → Console) and run:

   ```js
   JSON.parse(localStorage.getItem("profile")).auth.key
   ```

3. Paste the authKey, save, and use **Sync now**.

Afterwards the scheduler syncs Stremio once a day. Signing in again replaces the saved authKey.

### Trakt (data export)

1. Request your data export from Trakt (account settings, data section) and extract the archive.
2. Copy the JSON files into `exports/trakt/`. Used files: `watched-history-*.json` (or `watched-history.json`); the other files of the export are ignored.
3. Click **Import from Trakt** in *Viewing sources → Trakt*. The result message reports the history entries read, the new episodes and the new series; films are stored but not shown. The same import is available as an API call:

   ```bash
   curl -X POST http://localhost:3000/api/import/trakt
   ```

Entries already in the database are skipped, so the import can be repeated with a newer export.

The exports folder is `EXPORTS_PATH`, default `<project>/exports`. With Docker Compose, `./exports` on the host is mounted at `/app/exports` (`EXPORTS_PATH=/app/exports`), so the files go in `./exports/trakt/` next to `docker-compose.yml`. If `exports/trakt/` does not exist, the first subfolder whose name starts with `trakt` is used.

### CSV upload

Drag a file onto the area in *Viewing sources → CSV file* (or use *choose a file*). The *Format* selector, under *Advanced options (format and dates)*, chooses the format: *Auto* (default) detects it from the header row; *Netflix* or *Prime Video* force it.

- **Netflix**: `NetflixViewingHistory.csv`, downloaded from *Account → Profile → Viewing activity → Download all*. Columns `Title`, `Date`. Netflix writes dates in the profile's locale: month first in US exports (`8/29/26`), day first in Italian/European ones (`29/08/2026`). The order is detected from the **whole file**: a single date with the day above 12 decides it. If the file contains both orders, the import stops with an error. If every date is ambiguous (day ≤ 12), the *Netflix dates* selector (also under *Advanced options*) decides; in *Auto* day/month/year is used. The result message says which order was applied. Slashes, dots or dashes are accepted as separators, two-digit years are read as 20YY, and ISO dates (`2026-08-29`) are read as they are. Rows whose date is not a real calendar date (e.g. `31/02/26`) or is not recognized are skipped and counted in the result.
- **Prime Video watch-history CSV**: the CSV produced by [Watch History Exporter for Amazon Prime Video](https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video) (John Goodliff, The Unlicense) from the primevideo.com watch history, with the columns `Date Watched`, `Type`, `Title`, `Episode Title` (plus optional `Global Title Identifier`, `Path`, `Image URL`, …). Columns are read by name, in any order. Detected automatically when the header contains both `Date Watched` and `Title`. The date is the first 10 characters of `Date Watched` (`YYYY-MM-DD`); for series the season suffix is removed from the title (`Show - Stagione 3` → `Show`), for `Type = Movie` the title is kept as is. The official Amazon export (*Request your data*) uses a different format and is **not supported yet**.
- **Prime Video, simple** (limited): first column title, second column date, stored as-is (use `YYYY-MM-DD`). Used when *Prime Video* is selected but the header has no `Date Watched`, or in *Auto* when the header contains `prime`, `playback` or `video` and not both `title` and `date`. A file whose header is just `Title,Date` has the same columns as the Netflix export, so in *Auto* it is **read as Netflix**: select *Prime Video* in *Format* to import it as Prime Video. The result message names the format that was applied.

Rows already in the database are skipped, so the same file (or a newer one) can be uploaded again: only new rows are added. The TMDB search runs once per distinct title, and only for new rows.

## Language and region

Three independent settings, stored in the database (`config` table). An environment variable only provides the initial value: a value saved in the database wins.

| Setting | Env (initial value) | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `app_locale` | `WATCHSENSE_LOCALE` | `en` | Language of the UI and of the LLM output: `en` or `it`. |
| `tmdb_language` | `TMDB_LANGUAGE` | `en-US` | Language of titles, overviews and metadata from TMDB, as `xx-YY` (e.g. `it-IT`, `en-GB`). |
| `tmdb_region` | `TMDB_REGION` | `US` | ISO 3166-1 country code for streaming providers and charts (e.g. `IT`, `GB`). |

Resolution, per setting: database value → environment variable → default. Invalid values (an unsupported language, a malformed code) are ignored and the next source is used.

**Existing installs keep Italian.** On upgrade, migration v10 writes `it` / `it-IT` / `IT` if the database already holds viewing history (only for settings not set yet), so an existing instance never switches to English. A new, empty database gets the English defaults.

Change them in **Settings → General → Language and region**. The app language applies at once, without a reload; a new region also changes which platform charts the Home offers (the *Home sections* list in Settings → General follows it). The same settings can be set through the API: `POST /api/config` with `{"locale": {"app_locale": "it", "tmdb_language": "it-IT", "tmdb_region": "IT"}}` (invalid values are rejected with `400`).

Platform charts depend on the region. WatchSense knows which services have a chart in a set of verified countries (IT, US, GB, DE, FR, ES, NL, SE, PL, AU, BR, MX, CA, JP, IN); any other country only gets the charts available everywhere (Netflix, Disney+, Apple TV+).

**Data already stored is not rewritten.** Titles, overviews and the taste profile keep the language they were saved in; new data uses the new setting. Regenerate the taste profile (**Settings → Artificial intelligence → Regenerate summary**) to get it in the new language.

## Access and security

WatchSense has no user accounts. Who can use it depends on **where it listens** and on an **optional access token**.

**Listening address.** The built server listens on `HOST` (or `NITRO_HOST`) and `PORT`; with no `HOST` it listens on all interfaces. The Docker image and the example below set `HOST=0.0.0.0`. To use it only from the same machine set `HOST=127.0.0.1`; to reach it from your devices over Tailscale keep `0.0.0.0` or use the Tailscale IP of the host. With Docker Compose the container always listens on `0.0.0.0`: restrict the published port instead (e.g. `"127.0.0.1:3000:3000"` in `ports:`).

**Access token (`WATCHSENSE_TOKEN`).** Optional, **off by default**:
- **Unset or empty**: no login, the app works as before. Anyone who can reach the port has full access. At startup the server prints one warning line if it is not listening on loopback only.
- **Set**: every `/api/**` request needs either the session cookie set by the login screen or the header `Authorization: Bearer <token>`. The app shows a login screen (*Access token*); a `401` from any request brings it back. Public endpoints: `/api/health` (healthcheck), `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, the icon endpoint `/api/_nuxt_icon/*` and `/api/sync/ingest` (bookmarklet, protected by its own [ingest token](#bookmarklet-netflix-and-prime-video)).

Details:
- Use a long random value, e.g. `openssl rand -hex 32`. Changing the token logs out every browser (the `ws_session` cookie is an HMAC derived from the token, not the token itself; it is `HttpOnly`, `SameSite=Strict`, valid for 30 days, and `Secure` when the request is HTTPS). **Log out** in the header removes the cookie from that browser.
- Wrong logins are limited to 10 per minute per IP address (behind a reverse proxy, per proxy).
- The bookmarklet keeps working with the token set: it does not contain `WATCHSENSE_TOKEN`, only the ingest token, which can be read or regenerated only after logging in.
- The token travels in clear text over plain HTTP. If the instance is reachable from an untrusted network, put it behind an HTTPS reverse proxy (Caddy, nginx, `tailscale serve`).

*Settings → Access and security* shows whether the login is enabled (read-only: the token is set in the environment), the bookmarklet token and a reminder about the secrets stored in the database.

Recommended setups:
- **Private network** (LAN you trust, Tailscale, WireGuard): token optional.
- **Anything else** (shared network, port forwarded, public server): set `WATCHSENSE_TOKEN` **and** use HTTPS. Do not expose the port to the Internet without both.

### Stored secrets

Netflix cookies, the Stremio authKey, the TMDB and LLM API keys saved from Settings and the bookmarklet token are **encrypted** in the database (AES-256-GCM, a random IV per value, stored as `enc:v1:...`). The Stremio password is never stored. Everything else in the database (history, settings, sync status) is not encrypted.

**The encryption key** (32 bytes) comes from, in this order:
1. `WATCHSENSE_SECRET_KEY`: 64 hex characters or 32 bytes in base64, e.g. `openssl rand -base64 32`. Any other value (such as a passphrase) is rejected at startup.
2. Otherwise a **key file**, `WATCHSENSE_SECRET_KEY_FILE` or by default `secret.key` in the database folder (`data/secret.key`; in Docker `/app/data/secret.key`, so in the `./data` volume). If it does not exist it is created at the first start with mode `0600`. If it exists but cannot be read or is not valid, WatchSense logs an error and refuses to open the database instead of creating a new key (that would make the saved secrets unreadable): fix or restore the file.

At startup WatchSense also sets the database, its `-wal`/`-shm` files and the key file to `0600` (when they belong to the user running it) and removes access for other users from the default `data/` folder.

**Key lost or changed.** Secrets saved with another key cannot be decrypted: WatchSense treats them as not configured, logs a warning with the secret's name only, and Settings shows *Saved secret can't be decrypted (encryption key changed or missing): enter it again* on the card concerned. Saving the value again stores it with the current key. For the bookmarklet, regenerate the token and install the bookmarklet again. Restoring the old key makes the old values readable again.

**What it protects.** A copy of the database alone (a backup, a synced folder, a stolen disk image without the key file) does not reveal the secrets. Anyone with full access to the server or the container can still read the key and the secrets, as with any self-hosted app.

## Environment variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `TMDB_API_KEY` | *(empty)* | TMDB v3 API key. Required for metadata, unless set in Settings (which takes precedence). |
| `LLM_BASE_URL` | *(empty)* | Base URL of the OpenAI-compatible provider. If only `LLM_API_KEY` is set, the Kilo URL is used. |
| `LLM_API_KEY` | *(empty)* | Provider API key. Optional for local addresses. |
| `LLM_MODEL` | `kilo-auto/free` | Model name. The default exists only on Kilo. |
| `KILO_API_KEY` | *(empty)* | Legacy fallback, used only if no `LLM_BASE_URL`/`LLM_API_KEY` is set. |
| `KILO_BASE_URL` | `https://api.kilo.ai/api/gateway` | Legacy fallback base URL for Kilo. |
| `OPENROUTER_API_KEY` | *(empty)* | Legacy fallback, always sent to `https://openrouter.ai/api/v1`. |
| `WATCHSENSE_LOCALE` | `en` | Initial UI and LLM language (`en`, `it`). See [Language and region](#language-and-region). |
| `TMDB_LANGUAGE` | `en-US` | Initial TMDB metadata language (`xx-YY`). See [Language and region](#language-and-region). |
| `TMDB_REGION` | `US` | Initial country for streaming providers and charts. See [Language and region](#language-and-region). |
| `SYNC_INTERVAL_HOURS` | `12` | Interval of the automatic Netflix sync, in hours. A value chosen in Settings (6, 12 or 24) takes precedence. |
| `DATABASE_PATH` | `<project>/data/watchsense.db` | SQLite database file. Relative paths are resolved from the working directory. |
| `EXPORTS_PATH` | `<project>/exports` | Folder with the Trakt exports. |
| `SCHEMA_PATH` | `<project>/db/schema.sql` | Baseline SQLite schema (migration v1). Normally not needed. |
| `PORT` | `3000` | HTTP port of the built server (read by Nitro). In Docker Compose it sets the **host** port; the container always listens on 3000. |
| `HOST` | all interfaces | Listening address of the built server (read by Nitro, also as `NITRO_HOST`). `127.0.0.1` = this machine only. See [Access and security](#access-and-security). |
| `WATCHSENSE_TOKEN` | *(empty)* | Optional access token. Empty = no login. See [Access and security](#access-and-security). |
| `WATCHSENSE_SECRET_KEY` | *(empty)* | Key that encrypts the saved secrets: 64 hex characters or 32 bytes in base64 (`openssl rand -base64 32`). Empty = use the key file. See [Stored secrets](#stored-secrets). |
| `WATCHSENSE_SECRET_KEY_FILE` | `<database folder>/secret.key` | Key file, created with mode `0600` if missing. Ignored when `WATCHSENSE_SECRET_KEY` is set. |

`<project>` is the folder that contains `db/schema.sql`, found automatically. The Docker image sets `DATABASE_PATH=/app/data/watchsense.db`, `EXPORTS_PATH=/app/exports` and `SCHEMA_PATH=/app/db/schema.sql`.

Where variables are read from:
- **Docker Compose**: `.env` next to `docker-compose.yml`.
- **Built server and `npm run dev`**: the process environment, plus `<project>/.env`, which the server loads at startup when the file exists (Node.js ≥ 20.12, `process.loadEnvFile`). Variables already set in the environment are **not** overridden: values from the shell, systemd (`Environment=`, `EnvironmentFile=`) or `ui/.env` (loaded by Nuxt in dev) win, so loading the same file twice is harmless. `.env` is read once at startup: restart after changing it. A `PORT` or `HOST` in `.env` also applies to the built server unless set in the environment. The dev server always uses port 3333.

## Running as a systemd user service

Example for a non-Docker install (build first with `cd ui && npm ci && npm run build`). Adjust the paths to where you cloned the repository.

`~/.config/systemd/user/watchsense.service`:

```ini
[Unit]
Description=WatchSense
After=network-online.target

[Service]
WorkingDirectory=%h/watchsense/ui
EnvironmentFile=%h/watchsense/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node .output/server/index.mjs
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now watchsense.service
loginctl enable-linger "$USER"   # keep it running after logout
```

`EnvironmentFile` reads the same `KEY=value` lines as `.env`. It is optional when the file is `<project>/.env`, which the server loads by itself; keeping both is harmless. Rebuild and restart the service after every update.

## Backup and restore

All data (history, feedback, recommendations, bookmarks, settings and stored credentials) is in one SQLite database, by default `data/watchsense.db`. It runs in WAL mode, so recent writes may still be in `watchsense.db-wal`.

**Online backup** (app running), with the `sqlite3` CLI:

```bash
sqlite3 data/watchsense.db ".backup 'watchsense-$(date +%F).db'"
```

**Offline backup**: stop the app (`docker compose stop`, or stop the service), then copy `watchsense.db` together with `watchsense.db-wal` and `watchsense.db-shm` if present.

**Restore**: stop the app, remove the existing `watchsense.db-wal` and `watchsense.db-shm`, copy the backup to `data/watchsense.db`, start the app.

The saved secrets in the database are encrypted with the key in `data/secret.key` (or `WATCHSENSE_SECRET_KEY`), which is **not** part of the database backup (`watchsense.db*`):
- **Back up the key separately** and keep it safe, ideally not next to the database backups: the database alone does not reveal the secrets, the database together with the key does. Without the key, the saved cookies, keys and bookmarklet token have to be entered again after a restore (everything else is restored normally).
- Keep backups private, e.g. `chmod 600 watchsense-*.db secret.key`: they still contain your viewing history and settings.
- When restoring onto a new machine, copy `secret.key` back into `data/` (or set the same `WATCHSENSE_SECRET_KEY`) before starting the app.

### Export your data

**Settings → System → Export your data** downloads your data in open formats, to keep or to use elsewhere. It is not a backup: it cannot be imported back (use the database backup above for that).

- **Viewing history (CSV)**: one row per episode watched, from every platform, oldest first. Columns: `title` (TMDB name, or the imported title if unmatched), `original_title` (as imported), `season`, `episode` (when the platform gives them), `episode_title`, `platform`, `watched_at`, `tmdb_id`, `manual`. UTF-8 with BOM, so Excel shows accents correctly.
- **Full profile (JSON)**: your series (episodes watched, platforms, dates, watch status, 👍/👎, saved, ignored or excluded from the profile), the titles without a TMDB match, your taste notes, AI summary and taste profile, saved series, past recommendations and the same episode history.

TV series only: films are not exported, like everywhere else in WatchSense. Passwords, cookies, API keys, the bookmarklet token and other settings are never included. With [login](#access-and-security) enabled, the downloads need a signed-in session (or `Authorization: Bearer`): `GET /api/export/history.csv` and `GET /api/export/profile.json`.

### Schema upgrades

The database schema is versioned with SQLite's `PRAGMA user_version`. At startup WatchSense applies any pending migration, each in its own transaction: if one fails it is rolled back, the database stays at the previous version and the error is shown in the log. Take a backup before upgrading. A database written by a newer WatchSense is refused by an older one: upgrade, or restore a backup made with that version.

To add a migration (developers): create `ui/server/db/migrations/NNN_name.ts` exporting a `Migration` (`{ version, name, up(db) }`) with the next version number, and append it to the list in `ui/server/db/migrations/index.ts`. Never edit `db/schema.sql`: it is the frozen v1 baseline. Helpers such as `hasColumn` and `rebuildTable` are in `ui/server/db/migrate.ts`; set `disableForeignKeys: true` when rebuilding a table referenced by a foreign key.
