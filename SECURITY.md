# Security policy

## Supported versions

Only the latest release (the current `main` branch) receives security fixes. Please update before reporting.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: on [peppeg/watchsense](https://github.com/peppeg/watchsense), open the **Security** tab and click **Report a vulnerability** (private vulnerability reporting).

Please include:

- the version or commit you tested;
- how you deploy it (Docker or manual, `HOST`, whether `WATCHSENSE_TOKEN` is set, reverse proxy or not);
- steps to reproduce and the impact you observed;
- logs or a proof of concept, **with cookies, tokens and API keys removed**.

## What to expect

WatchSense is a personal project maintained in spare time. There is no SLA: reports are handled on a best-effort basis. I will acknowledge the report, keep you informed, and credit you in the fix if you wish.

## Scope

WatchSense is a self-hosted, single-user application. Some behaviours are documented design choices, not vulnerabilities (see [Security](README.md#-security) in the README):

- Netflix session cookies, the Stremio authKey and LLM API keys saved from the UI are stored **in plain text** in the SQLite database. Protecting the database file and its backups is up to the operator.
- Without `WATCHSENSE_TOKEN` there is no login: anyone who can reach the port has full access. Running it like this on `0.0.0.0` is meant for trusted private networks only; see [Access and security](docs/CONFIGURATION.md#access-and-security).
- Recommendation requests send viewing history to the LLM provider you configure.

Issues in the third-party services WatchSense talks to (Netflix, Prime Video, Stremio, Trakt, TMDB, LLM providers) should be reported to those services.
