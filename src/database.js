const Database = require("better-sqlite3");

const db = new Database("shop.db");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    config TEXT NOT NULL,
    sold INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    config_id INTEGER,
    status TEXT DEFAULT 'waiting_receipt',
    receipt_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare(
    "SELECT COUNT(*) AS count FROM products"
).get().count;

if (count === 0) {
    db.prepare(
        "INSERT INTO products (name, price) VALUES (?, ?)"
    ).run("کانفیگ ۳۰ روزه", 100000);

    db.prepare(
        "INSERT INTO products (name, price) VALUES (?, ?)"
    ).run("کانفیگ ۹۰ روزه", 250000);
}

module.exports = db;
