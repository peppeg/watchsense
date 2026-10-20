# Contributing to WatchSense

Thanks for your interest. WatchSense is a small personal project: focused contributions are welcome.

## Development setup

Follow [Local development](README.md#local-development) in the README. In short:

```bash
cd ui
npm install
npm run dev      # http://localhost:3333
```

Set at least `TMDB_API_KEY` (in the root `.env`, in `ui/.env` or later in Settings). To get a populated app without your own history, build a demo database with `ui/scripts/seed-demo.mjs` (see [Screenshots](README.md#screenshots)).

## Tests

```bash
cd ui
npx vitest run
npm run build
```

Both must pass before you open a pull request. Add tests for new behaviour and for bug fixes.

## Rules of the codebase

- **i18n.** The UI is in English (default) and Italian. Every user-facing string goes in both `ui/app/locales/en.ts` and `ui/app/locales/it.ts`; the parity test in `ui/tests/i18n.test.ts` fails if the two dictionaries do not have the same keys. Server messages shown to the user go through the dictionaries too. See [ADR-001](docs/adr/ADR-001-internationalization.md).
- **Series only.** WatchSense is about TV series. Films in imported histories are stored (`media_type = 'movie'`) but never shown, enriched or used for recommendations. Please do not add film features without discussing it in an issue first.
- **Database changes** go in a new migration (see [Schema upgrades](docs/CONFIGURATION.md#schema-upgrades)); `db/schema.sql` is the frozen v1 baseline and is not edited.
- **Docs.** If you change behaviour or settings, update `README.md`/`docs/CONFIGURATION.md` and their Italian counterparts (`*.it.md`).

## Pull requests

- Keep pull requests small and focused on one change; open an issue first for larger work.
- Commit messages follow the style of the git log: `type(scope): summary`, e.g. `feat(settings): ...`, `fix(watch-status): ...`, `docs: ...`, `chore(ui): ...`.
- Never commit `.env`, databases, exports, cookies or API keys, and remove them from logs and screenshots.

## Adding a viewing source

The current sources are listed in [Supported sources](README.md#supported-sources). New ones (e.g. Jellyfin or Plex) are welcome.

- All imports go through the shared pipeline `runIngest` in `ui/server/utils/ingest.ts` (insert with deduplication, TMDB matching, enrichment, watch status). Helpers live next to it (`ui/server/utils/ingest-*.ts`, `netflix.ts`, `stremio.ts`, `csv-import.ts`). A new source should produce `IngestRow`s and call `runIngest`, not write to the database directly.
- Sync endpoints live in `ui/server/api/sync/` (one-off imports in `ui/server/api/import/`); scheduled syncs are in `ui/server/plugins/scheduler.ts`.
- You must be able to test the source yourself, end to end, **with your own account**. Include tests with small, fictional fixtures (never a real export).
- A source may only read the viewing history of the account the user connects. No scraping of other people's data, no bypassing of access controls.
- Document the source in the README (both languages) and in [Sync methods](docs/CONFIGURATION.md#sync-methods).

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
