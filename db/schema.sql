-- WatchSense — Schema del database
-- Baseline v1 delle migrazioni (ui/server/db/migrations/001_baseline.ts): il server
-- lo applica a un DB nuovo o adotta un DB esistente con PRAGMA user_version = 0.
-- CONGELATO: non modificarlo; ogni cambio di schema va in una nuova migrazione.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,          -- netflix, prime, nowtv, trakt
    watched_at TEXT,                 -- ISO date or NULL
    episode_title TEXT,
    tmdb_id INTEGER,
    tmdb_name TEXT,
    tmdb_genres TEXT,                -- JSON array
    tmdb_overview TEXT,
    tmdb_keywords TEXT,              -- JSON array
    tmdb_networks TEXT,              -- JSON array
    tmdb_watch_providers TEXT,       -- JSON array (IT)
    tmdb_vote_avg REAL,
    tmdb_status TEXT,
    enriched_at TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    tmdb_number_of_episodes INTEGER,
    tmdb_number_of_seasons INTEGER,
    tmdb_first_air_date TEXT,
    UNIQUE(title, platform, watched_at, episode_title)
);

CREATE TABLE IF NOT EXISTS show_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tmdb_id INTEGER NOT NULL UNIQUE,
    feedback INTEGER NOT NULL DEFAULT 0,   -- 1=liked, -1=disliked, 0=neutral
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recommendation_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT,
    genre_filter TEXT,
    taste_snapshot TEXT,             -- JSON: generi pesati + liked/disliked al momento del batch
    prompt_snapshot TEXT
);

CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    tmdb_id INTEGER,
    reason TEXT,
    where_to_watch TEXT,
    score REAL,
    created_at TEXT DEFAULT (datetime('now')),
    feedback INTEGER,                -- 1=liked, -1=disliked, NULL=pending
    bookmarked INTEGER DEFAULT 0,
    already_watched INTEGER DEFAULT 0,
    poster_path TEXT,
    dismissed INTEGER DEFAULT 0,
    batch_id INTEGER REFERENCES recommendation_batches(id)
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS show_ai_similar (
    tmdb_id INTEGER PRIMARY KEY,
    recommendations TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS show_user_status (
    tmdb_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,            -- 'unwatched', 'in_progress', 'completed'
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Indici utili
CREATE INDEX IF NOT EXISTS idx_shows_tmdb_id ON shows(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_shows_platform ON shows(platform);
CREATE INDEX IF NOT EXISTS idx_shows_platform_date ON shows(platform, watched_at);
CREATE INDEX IF NOT EXISTS idx_recommendations_batch ON recommendations(batch_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_tmdb ON recommendations(tmdb_id);
