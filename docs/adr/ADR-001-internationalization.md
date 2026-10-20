# ADR-001: Internationalization (i18n) and region support

- **Status:** Accepted — blocking for the public release (before T26)
- **Date:** 2026-10-20
- **Scope:** UI (Nuxt/Vue), server (Nitro/SQLite), TMDB, LLM prompts

## Context

WatchSense grew as a personal, Italy-only homelab app: every UI string is hard-coded in Italian,
TMDB calls use `language=it-IT` / `watch_region=IT`, genres are stored in Italian (migration v9),
LLM prompts ask for Italian titles and Italian streaming platforms, dates are formatted with
`it-IT`. The README and configuration guide are already in English. Publishing an English repo
whose app only works for Italy would make no sense, so i18n becomes a release blocker
(formerly T33, post-release).

What is already language-neutral: ingest title cleanup (season suffixes in it/en/de/es/fr/nl/pl)
and Netflix CSV date detection (US and European order).

## Decision

One codebase, multilingual. English is the default for new installs; Italian is complete and
first-class. The author's instance keeps running in Italian.

### 1. Configuration

Three independent keys in the `config` table, editable in Settings; environment variables only
provide the initial value. No per-user cookie: WatchSense is single-user.

| Config key | Env (initial value) | Default | Meaning |
|---|---|---|---|
| `app_locale` | `WATCHSENSE_LOCALE` | `en` | UI and LLM output language (`en`, `it`) |
| `tmdb_language` | `TMDB_LANGUAGE` | `en-US` | Titles, overviews, metadata from TMDB |
| `tmdb_region` | `TMDB_REGION` | `US` | ISO 3166-1 country for streaming providers and charts |

Resolution: DB value → env → default.

**Existing installs:** a migration writes `it` / `it-IT` / `IT` when the database already holds
viewing history, so an upgrade never switches an existing instance to English.

### 2. UI strings

- Small typed composable `useI18n()` (`locale`, `t(key, params)`), no new dependency.
- Dictionaries `app/locales/en.ts` (source of keys) and `app/locales/it.ts`, namespaced per
  view (`common`, `nav`, `dashboard`, `library`, `recommendations`, `show`, `settings`, …);
  missing keys fall back to `en`.
- Plurals via a small helper (`count === 1 ? one : other`), enough for en/it.
- Dates and numbers through `Intl` with the active locale (no more literal `'it-IT'`).
- Server messages shown to the user (sync results, errors) become codes + params translated in
  the UI; the stored `last_sync_status_*` keeps the code, not a sentence.

### 3. TMDB, genres, statuses, charts

- `tmdb.ts` and `sync-helpers.ts` read `tmdb_language` / `tmdb_region`; watch providers come from
  `results[region]` instead of `results.IT`.
- **Genres are stored canonically in English** (TMDB names) and translated at display time.
  Migration v11 maps the Italian names written by v9 back to English. Stats, taste profile and
  prompts translate through the same table.
- TMDB statuses (`Ended`, `Returning Series`, …) translated through the dictionaries.
- **Home charts depend on the region:** a small static table lists which chart providers exist in
  which region (e.g. NOW only in IT/GB/DE). Unavailable charts are not shown and not fetched.
  No dynamic provider discovery for now.

### 4. LLM prompts

`generate.post.ts`, `taste-profile/synthesize.post.ts` and `utils/ai-similar.ts` take the output
language from `app_locale` and the platforms from `tmdb_region` ("official title as released in
<country>", rationale in the chosen language).

### Out of scope

- Re-enriching stored metadata after a language change. Settings shows a note: the TMDB language
  applies to new data; titles, overviews and the taste profile already stored stay as they are
  until regenerated.
- Locale-prefixed routes (`/en/...`), browser language negotiation, languages other than en/it
  (the dictionary structure allows adding them later).

## Implementation plan

1. **I18N-1** Config keys, resolver, migration v10 for existing installs. Tests.
2. **I18N-2** TMDB language/region, genres v11 + display translation, statuses, region chart table.
3. **I18N-3** LLM prompts parametrized.
4. **I18N-4** `useI18n`, dictionaries skeleton, `Intl` formatting, server message codes.
5. **I18N-5** Move UI strings to dictionaries, in blocks: (a) app, Dashboard, ShowRow/ShowCard;
   (b) Library, ShowDetail, TmdbMatchDialog; (c) Recommendations, Bookmarks, Login;
   (d) Settings alone. Language selector in Settings.
6. **I18N-6** Tests updated, English demo DB (`seed-demo.mjs`), English screenshots for the README,
   CONFIGURATION docs updated.

## Consequences

- The repository and the app speak the same language; anyone can set their own language and region.
- The author's instance stays Italian with no visible change after the upgrade.
- New strings must always go through `t()`: adding one only in Italian is a bug.
