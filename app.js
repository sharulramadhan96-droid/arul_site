/* Kasir UMKM Sayur - Frontend only, integrates two external APIs:
   1) Products API: https://dummyjson.com/products/category/groceries
   2) Currency rates API: https://api.exchangerate.host/latest?base=IDR
   - Carts persisted in localStorage
   - Checkout generates QR code that encodes a payment payload
*/

const state = {
  catalogProducts: [],
  filteredProducts: [],
  cartItems: [],
  currency: 'IDR',
  rates: { IDR: 1 },
  taxRate: 0.1,
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  bindEvents();
  restoreFromStorage();
  loadAll();
});

function cacheDom() {
  els.productGrid = document.getElementById('productGrid');
  els.catalogStatus = document.getElementById('catalogStatus');
  els.searchInput = document.getElementById('searchInput');
  els.currencySelect = document.getElementById('currencySelect');
  els.refreshBtn = document.getElementById('refreshBtn');

  els.cartList = document.getElementById('cartList');
  els.subtotalText = document.getElementById('subtotalText');
  els.taxText = document.getElementById('taxText');
  els.totalText = document.getElementById('totalText');
  els.payAmount = document.getElementById('payAmount');
  els.checkoutBtn = document.getElementById('checkoutBtn');
  els.checkoutStatus = document.getElementById('checkoutStatus');
  els.qrContainer = document.getElementById('qrContainer');
}

function bindEvents() {
  els.searchInput.addEventListener('input', () => {
    applySearch();
    renderCatalog();
  });
  els.currencySelect.addEventListener('change', () => {
    state.currency = els.currencySelect.value;
    persistToStorage();
    updateTotals();
  });
  els.refreshBtn.addEventListener('click', () => {
    loadAll();
  });
  els.checkoutBtn.addEventListener('click', handleCheckout);
}

function restoreFromStorage() {
  try {
    const raw = localStorage.getItem('kasir_sayur_state');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.cartItems) state.cartItems = saved.cartItems;
    if (saved.currency) state.currency = saved.currency;
    els.currencySelect.value = state.currency;
  } catch {}
}

function persistToStorage() {
  const snapshot = {
    cartItems: state.cartItems,
    currency: state.currency,
  };
  localStorage.setItem('kasir_sayur_state', JSON.stringify(snapshot));
}

async function loadAll() {
  els.catalogStatus.textContent = 'Memuat produk & kurs...';
  try {
    const [products, rates] = await Promise.all([
      fetchProducts(),
      fetchRates(),
    ]);
    state.catalogProducts = products;
    state.filteredProducts = products;
    state.rates = rates;
    applySearch();
    renderCatalog();
    updateTotals();
    els.catalogStatus.textContent = `Memuat ${products.length} produk. Kurs terbarui.`;
  } catch (e) {
    console.error(e);
    els.catalogStatus.textContent = 'Gagal memuat data. Periksa koneksi internet Anda.';
  }
}

async function fetchProducts() {
  const url = 'https://dummyjson.com/products/category/groceries?limit=100';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Produk API error');
  const json = await res.json();
  // Normalize minimal fields
  const products = (json.products || []).map(p => ({
    id: p.id,
    title: p.title,
    description: p.description,
    priceIDR: toIDRPrice(p.price), // DummyJSON price is USD-like, we convert heuristic below
    thumbnail: p.thumbnail,
    images: p.images,
    stock: p.stock,
  }));
  return products;
}

function toIDRPrice(usdLike) {
  // Heuristic: if API price assumed in USD, convert to IDR rough rate 1 USD ~ 16000
  const rate = 16000;
  return Math.round(Number(usdLike || 0) * rate);
}

async function fetchRates() {
  // Base IDR to others
  const url = 'https://api.exchangerate.host/latest?base=IDR';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Rates API error');
  const json = await res.json();
  const rates = json && json.rates ? json.rates : { IDR: 1 };
  rates.IDR = 1;
  return rates;
}

function applySearch() {
  const q = (els.searchInput.value || '').toLowerCase().trim();
  if (!q) {
    state.filteredProducts = state.catalogProducts;
    return;
  }
  state.filteredProducts = state.catalogProducts.filter(p =>
    p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
  );
}

function renderCatalog() {
  els.productGrid.innerHTML = '';
  const fr = document.createDocumentFragment();
  state.filteredProducts.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb">${p.thumbnail ? `<img src="${p.thumbnail}" alt="${escapeHtml(p.title)}" />` : ''}</div>
      <div class="body">
        <div class="title">${escapeHtml(p.title)}</div>
        <div class="desc">${escapeHtml(p.description || '')}</div>
        <div class="row">
          <span class="price">${formatMoney(convertFromIDR(p.priceIDR, state.currency))} ${state.currency}</span>
          <small>Stok: ${p.stock}</small>
        </div>
        <div class="row">
          <div class="qty">
            <button data-act="dec">-</button>
            <input type="number" min="1" value="1" style="width:50px;background:#0b1322;border:1px solid rgba(255,255,255,0.08);color:#e6ebf5;border-radius:8px;padding:6px 8px;" />
            <button data-act="inc">+</button>
          </div>
          <button class="add">Tambah</button>
        </div>
      </div>
    `;
    const qtyInput = card.querySelector('input[type="number"]');
    card.querySelector('[data-act="dec"]').addEventListener('click', () => qtyInput.value = Math.max(1, Number(qtyInput.value||1)-1));
    card.querySelector('[data-act="inc"]').addEventListener('click', () => qtyInput.value = Number(qtyInput.value||1)+1);
    card.querySelector('.add').addEventListener('click', () => addToCart(p, Number(qtyInput.value||1)));
    fr.appendChild(card);
  });
  els.productGrid.appendChild(fr);
}

function addToCart(product, qty) {
  const existing = state.cartItems.find(i => i.id === product.id);
  if (existing) {
    existing.qty += qty;
  } else {
    state.cartItems.push({ id: product.id, name: product.title, priceIDR: product.priceIDR, qty });
  }
  persistToStorage();
  renderCart();
  updateTotals();
}

function renderCart() {
  els.cartList.innerHTML = '';
  const fr = document.createDocumentFragment();
  state.cartItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <div class="meta">
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="note">${formatMoney(convertFromIDR(item.priceIDR, state.currency))} ${state.currency} × ${item.qty}</div>
      </div>
      <div class="controls">
        <button data-act="dec">-</button>
        <span>${item.qty}</span>
        <button data-act="inc">+</button>
        <button data-act="rm" style="color:#ffb4b4;border-color:rgba(255,100,100,0.3)">Hapus</button>
      </div>
    `;
    row.querySelector('[data-act="dec"]').addEventListener('click', () => changeQty(item.id, -1));
    row.querySelector('[data-act="inc"]').addEventListener('click', () => changeQty(item.id, +1));
    row.querySelector('[data-act="rm"]').addEventListener('click', () => removeItem(item.id));
    fr.appendChild(row);
  });
  els.cartList.appendChild(fr);
}

function changeQty(id, delta) {
  const it = state.cartItems.find(i => i.id === id);
  if (!it) return;
  it.qty += delta;
  if (it.qty <= 0) {
    state.cartItems = state.cartItems.filter(i => i.id !== id);
  }
  persistToStorage();
  renderCart();
  updateTotals();
}

function removeItem(id) {
  state.cartItems = state.cartItems.filter(i => i.id !== id);
  persistToStorage();
  renderCart();
  updateTotals();
}

function computeTotalsIDR() {
  const subtotal = state.cartItems.reduce((sum, it) => sum + it.priceIDR * it.qty, 0);
  const tax = Math.round(subtotal * state.taxRate);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

function updateTotals() {
  const { subtotal, tax, total } = computeTotalsIDR();
  els.subtotalText.textContent = `${formatMoney(convertFromIDR(subtotal, state.currency))} ${state.currency}`;
  els.taxText.textContent = `${formatMoney(convertFromIDR(tax, state.currency))} ${state.currency}`;
  els.totalText.textContent = `${formatMoney(convertFromIDR(total, state.currency))} ${state.currency}`;
}

function convertFromIDR(amountIDR, targetCurrency) {
  const rate = state.rates[targetCurrency] || 1;
  // since base is IDR, targetAmount = amountIDR * rate
  return amountIDR * rate;
}

function formatMoney(n) {
  try {
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function handleCheckout() {
  els.checkoutStatus.textContent = '';
  els.qrContainer.innerHTML = '';
  const { total } = computeTotalsIDR();
  if (total <= 0) {
    els.checkoutStatus.textContent = 'Keranjang masih kosong.';
    return;
  }
  // If user hasn't entered pay amount, auto-fill with total in selected currency
  let pay = Number(els.payAmount.value || 0);
  const totalInSelected = convertFromIDR(total, state.currency);
  if (!Number.isFinite(pay) || pay <= 0) {
    els.payAmount.value = String(round2(totalInSelected));
    pay = Number(els.payAmount.value);
  }
  if (!Number.isFinite(pay) || pay <= 0) {
    els.checkoutStatus.textContent = 'Masukkan nominal bayar.';
    return;
  }
  if (pay < totalInSelected) {
    els.checkoutStatus.textContent = 'Nominal kurang dari total belanja.';
    return;
  }
  const kembalian = pay - totalInSelected;
  const payload = buildPaymentPayload({
    merchant: 'UMKM SAYUR SEHAT',
    currency: state.currency,
    amount: round2(totalInSelected),
    paid: round2(pay),
    change: round2(kembalian),
    items: state.cartItems.map(i => ({ name: i.name, qty: i.qty, priceIDR: i.priceIDR })),
    time: new Date().toISOString(),
  });
  // Prefer local QR library; fallback to hosted QR image if unavailable
  if (window.QRCode && typeof QRCode.toCanvas === 'function') {
    const canvas = document.createElement('canvas');
    els.qrContainer.appendChild(canvas);
    QRCode.toCanvas(canvas, payload, { width: 220, margin: 1 }, (err) => {
      if (err) {
        console.error(err);
        els.checkoutStatus.textContent = 'Gagal membuat QR.';
        return;
      }
      els.checkoutStatus.textContent = `Berhasil. Kembalian: ${formatMoney(kembalian)} ${state.currency}`;
    });
  } else {
    const img = new Image();
    img.width = 220;
    img.height = 220;
    img.alt = 'QR Pembayaran';
    // Public QR fallback service
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(payload);
    els.qrContainer.appendChild(img);
    els.checkoutStatus.textContent = `Berhasil. Kembalian: ${formatMoney(kembalian)} ${state.currency}`;
  }
}

function buildPaymentPayload(data) {
  // Keep it short but informative
  const minified = {
    m: data.merchant,
    c: data.currency,
    a: data.amount,
    p: data.paid,
    ch: data.change,
    it: data.items.map(i => ({ n: i.name, q: i.qty })),
    t: data.time,
  };
  return JSON.stringify(minified);
}

function round2(n) { return Math.round(n * 100) / 100; }

// Initial renders
renderCart();
updateTotals();


