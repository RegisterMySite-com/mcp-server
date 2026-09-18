-- FTS, document embedding pointer, email templates + sends
PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN embedding_id TEXT;

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  content,
  tags,
  content='notes',
  content_rowid='rowid'
);

INSERT INTO notes_fts(rowid, title, content, tags)
  SELECT rowid, title, content, tags FROM notes
  WHERE NOT EXISTS (SELECT 1 FROM notes_fts LIMIT 1);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO notes_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS email_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  html        TEXT NOT NULL,
  text        TEXT,
  brand_name  TEXT,
  variables   TEXT NOT NULL DEFAULT '[]',
  user_id     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_templates_user ON email_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_brand ON email_templates(brand_name);

CREATE TABLE IF NOT EXISTS email_sends (
  id                   TEXT PRIMARY KEY,
  to_addrs             TEXT NOT NULL,
  subject              TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'queued',
  provider_message_id  TEXT,
  template_id          TEXT,
  tags                 TEXT NOT NULL DEFAULT '[]',
  metadata             TEXT,
  error                TEXT,
  user_id              TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_sends_user ON email_sends(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_status ON email_sends(status);
CREATE INDEX IF NOT EXISTS idx_email_sends_created ON email_sends(created_at DESC);

INSERT OR IGNORE INTO email_templates (id, name, subject, html, text, brand_name, variables, user_id)
VALUES (
  'tpl-welcome',
  'Welcome',
  'Welcome to {{brandName}}',
  '<div style="font-family:sans-serif;max-width:560px"><h1>Welcome to {{brandName}}</h1><p>Hi {{firstName}},</p><p>{{message}}</p><p>— The {{brandName}} team</p></div>',
  'Welcome to {{brandName}}\n\nHi {{firstName}},\n\n{{message}}\n',
  'RegisterMySite',
  '["brandName","firstName","message"]',
  NULL
);
