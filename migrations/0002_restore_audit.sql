CREATE TABLE IF NOT EXISTS restored_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS operations_revision ON operations(revision);
