PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS banquets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  banquet_date TEXT NOT NULL,
  banquet_time TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_id TEXT NOT NULL,
  updated_by_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banquet_id INTEGER NOT NULL REFERENCES banquets(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK(amount > 0),
  received_at TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_banquets_date ON banquets(banquet_date, banquet_time);
CREATE INDEX IF NOT EXISTS idx_banquets_phone ON banquets(phone);
CREATE INDEX IF NOT EXISTS idx_advances_received ON advances(received_at);
CREATE INDEX IF NOT EXISTS idx_advances_banquet ON advances(banquet_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
