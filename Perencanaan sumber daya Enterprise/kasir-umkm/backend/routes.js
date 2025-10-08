import express from 'express';
import axios from 'axios';
import db from './db.js';
import { createObjectCsvStringifier } from 'csv-writer';

const router = express.Router();

// Helper: get product by barcode or create placeholder
function getOrCreateProductByBarcode(barcode, name, price = 0, unit = 'pcs') {
  const findStmt = db.prepare('SELECT * FROM products WHERE barcode = ?');
  let product = findStmt.get(barcode);
  if (!product) {
    const insert = db.prepare('INSERT INTO products (barcode, name, unit, price) VALUES (?, ?, ?, ?)');
    const info = insert.run(barcode, name, unit, price);
    product = { id: info.lastInsertRowid, barcode, name, unit, price };
  }
  return product;
}

// GET /api/products?query=...
router.get('/products', (req, res) => {
  const { query } = req.query;
  const stmt = query
    ? db.prepare("SELECT * FROM products WHERE name LIKE ? OR barcode LIKE ? ORDER BY id DESC").all(`%${query}%`, `%${query}%`)
    : db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 100').all();
  res.json(stmt);
});

// POST /api/products
router.post('/products', (req, res) => {
  const { barcode, name, unit = 'pcs', price = 0 } = req.body;
  if (!name) return res.status(400).json({ message: 'name is required' });
  try {
    const stmt = db.prepare('INSERT INTO products (barcode, name, unit, price) VALUES (?, ?, ?, ?)');
    const info = stmt.run(barcode || null, name, unit, Number(price || 0));
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(product);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// GET /api/barcode/:code -> Open Food Facts lookup
router.get('/barcode/:code', async (req, res) => {
  const code = req.params.code;
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
    const { data } = await axios.get(url, { timeout: 7000 });
    if (data && data.product) {
      const name = data.product.product_name || data.product.generic_name || 'Produk';
      // OFF may not provide price; keep 0 by default
      const product = getOrCreateProductByBarcode(code, name, 0);
      return res.json({ source: 'openfoodfacts', product });
    }
    res.status(404).json({ message: 'Produk tidak ditemukan pada Open Food Facts' });
  } catch (e) {
    res.status(502).json({ message: 'Gagal mengambil data dari Open Food Facts', error: e.message });
  }
});

// GET /api/rate?base=USD -> exchangerate.host
router.get('/rate', async (req, res) => {
  const base = (req.query.base || 'USD').toString().toUpperCase();
  try {
    const { data } = await axios.get(`https://api.exchangerate.host/latest?base=${base}&symbols=IDR`, { timeout: 7000 });
    const rate = data?.rates?.IDR;
    if (!rate) return res.status(502).json({ message: 'Gagal mendapatkan kurs IDR' });
    res.json({ base, to: 'IDR', rate });
  } catch (e) {
    res.status(502).json({ message: 'Gagal mengambil kurs', error: e.message });
  }
});

// POST /api/checkout { items: [{barcode?, name, unit_price, quantity}], currency, paid }
router.post('/checkout', async (req, res) => {
  const { items = [], currency = 'IDR', paid = 0 } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Daftar item kosong' });
  }

  // Get FX rate if not IDR
  let rateToIdr = 1.0;
  if (currency && currency.toUpperCase() !== 'IDR') {
    try {
      const { data } = await axios.get(`https://api.exchangerate.host/latest?base=${currency}&symbols=IDR`, { timeout: 7000 });
      rateToIdr = data?.rates?.IDR || 1.0;
    } catch {
      rateToIdr = 1.0;
    }
  }

  // Calculate totals (assuming prices are in IDR)
  const normalizedItems = items.map((it) => ({
    barcode: it.barcode || null,
    name: it.name,
    unit_price: Number(it.unit_price || 0),
    quantity: Number(it.quantity || 1),
  })).map((it) => ({ ...it, subtotal: it.unit_price * it.quantity }));

  const total = normalizedItems.reduce((acc, it) => acc + it.subtotal, 0);
  const paidInt = Number(paid || 0);
  const change = paidInt - total;

  const trx = db.transaction(() => {
    const insTrx = db.prepare('INSERT INTO transactions (total, currency, rate_to_idr, paid, change) VALUES (?, ?, ?, ?, ?)');
    const info = insTrx.run(total, currency.toUpperCase(), rateToIdr, paidInt, change);
    const trxId = info.lastInsertRowid;
    const insItem = db.prepare('INSERT INTO transaction_items (transaction_id, product_id, barcode, name, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const it of normalizedItems) {
      let productId = null;
      if (it.barcode) {
        const prod = db.prepare('SELECT * FROM products WHERE barcode = ?').get(it.barcode);
        if (prod) productId = prod.id;
      }
      insItem.run(trxId, productId, it.barcode, it.name, it.unit_price, it.quantity, it.subtotal);
    }
    return trxId;
  });

  const trxId = trx();
  const saved = db.prepare('SELECT * FROM transactions WHERE id = ?').get(trxId);
  const itemsSaved = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(trxId);
  res.status(201).json({ transaction: saved, items: itemsSaved });
});

// GET /api/transactions?limit=50
router.get('/transactions', (req, res) => {
  const limit = Number(req.query.limit || 50);
  const list = db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT ?').all(limit);
  res.json(list);
});

export default router;

// GET /api/export.csv?limit=200 -> export transaksi dan item sebagai CSV
router.get('/export.csv', (req, res) => {
  const limit = Number(req.query.limit || 200);
  const txs = db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT ?').all(limit);
  const txIds = txs.map((t) => t.id);
  let items = [];
  if (txIds.length) {
    const placeholders = txIds.map(() => '?').join(',');
    items = db.prepare(`SELECT * FROM transaction_items WHERE transaction_id IN (${placeholders}) ORDER BY id ASC`).all(...txIds);
  }

  const rows = [];
  for (const t of txs) {
    const its = items.filter((i) => i.transaction_id === t.id);
    if (its.length === 0) {
      rows.push({
        transaction_id: t.id,
        created_at: t.created_at,
        currency: t.currency,
        rate_to_idr: t.rate_to_idr,
        total: t.total,
        paid: t.paid,
        change: t.change,
        item_barcode: '',
        item_name: '',
        unit_price: '',
        quantity: '',
        subtotal: ''
      });
    } else {
      for (const it of its) {
        rows.push({
          transaction_id: t.id,
          created_at: t.created_at,
          currency: t.currency,
          rate_to_idr: t.rate_to_idr,
          total: t.total,
          paid: t.paid,
          change: t.change,
          item_barcode: it.barcode || '',
          item_name: it.name,
          unit_price: it.unit_price,
          quantity: it.quantity,
          subtotal: it.subtotal
        });
      }
    }
  }

  const csv = createObjectCsvStringifier({
    header: [
      { id: 'transaction_id', title: 'transaction_id' },
      { id: 'created_at', title: 'created_at' },
      { id: 'currency', title: 'currency' },
      { id: 'rate_to_idr', title: 'rate_to_idr' },
      { id: 'total', title: 'total' },
      { id: 'paid', title: 'paid' },
      { id: 'change', title: 'change' },
      { id: 'item_barcode', title: 'item_barcode' },
      { id: 'item_name', title: 'item_name' },
      { id: 'unit_price', title: 'unit_price' },
      { id: 'quantity', title: 'quantity' },
      { id: 'subtotal', title: 'subtotal' }
    ]
  });

  const out = csv.getHeaderString() + csv.stringifyRecords(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send('\uFEFF' + out);
});

