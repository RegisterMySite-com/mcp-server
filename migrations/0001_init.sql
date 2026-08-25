-- Cloudflare MCP Workspace — initial schema
-- Applied via: wrangler d1 migrations apply knowledge --local|remote

PRAGMA foreign_keys = ON;

-- Notes table (primary knowledge store)
CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,                 -- uuid
  title         TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  tags          TEXT DEFAULT '[]',                -- JSON array of strings
  user_id       TEXT,                             -- null = public / system
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  embedding_id  TEXT                              -- optional Vectorize id
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

-- Documents metadata (files living in R2)
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,             -- R2 object key
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  user_id       TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_key ON documents(key);

-- Simple audit / activity log
CREATE TABLE IF NOT EXISTS activity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  user_id       TEXT,
  meta          TEXT,                             -- JSON
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
