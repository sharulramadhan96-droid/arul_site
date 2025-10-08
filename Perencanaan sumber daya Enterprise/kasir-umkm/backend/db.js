import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'data', 'kasir.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  unit TEXT DEFAULT 'pcs',
  price INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  rate_to_idr REAL DEFAULT 1.0,
  paid INTEGER NOT NULL,
  change INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL,
  product_id INTEGER,
  barcode TEXT,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);
`);

export default db;

