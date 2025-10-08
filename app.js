const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let cart = [];

function renderProducts(list) {
  const ul = $('#product-list');
  ul.innerHTML = '';
  list.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${p.name}</strong><div style="font-size:12px;color:#475569">${p.barcode || ''}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <span>Rp ${p.price.toLocaleString('id-ID')}</span>
        <button data-id="${p.id}" data-name="${p.name}" data-price="${p.price}">Tambah</button>
      </div>`;
    ul.appendChild(li);
  });
  ul.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      const name = e.target.dataset.name;
      const price = Number(e.target.dataset.price);
      addToCart({ name, unit_price: price, quantity: 1 });
    }
  }, { once: true });
}

function renderCart() {
  const tbody = $('#cart-body');
  tbody.innerHTML = '';
  cart.forEach((it, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${it.name}</td>
      <td>Rp ${it.unit_price.toLocaleString('id-ID')}</td>
      <td>
        <input type="number" min="1" value="${it.quantity}" data-idx="${idx}" class="qty" style="width:68px" />
      </td>
      <td>Rp ${(it.unit_price * it.quantity).toLocaleString('id-ID')}</td>
      <td><button data-idx="${idx}" class="del">Hapus</button></td>`;
    tbody.appendChild(tr);
  });
  const total = cart.reduce((a, it) => a + it.unit_price * it.quantity, 0);
  $('#total').textContent = `Rp ${total.toLocaleString('id-ID')}`;

  tbody.addEventListener('input', (e) => {
    if (e.target.classList.contains('qty')) {
      const idx = Number(e.target.dataset.idx);
      cart[idx].quantity = Math.max(1, Number(e.target.value || 1));
      renderCart();
    }
  }, { once: true });
  tbody.addEventListener('click', (e) => {
    if (e.target.classList.contains('del')) {
      const idx = Number(e.target.dataset.idx);
      cart.splice(idx, 1);
      renderCart();
    }
  }, { once: true });
}

function addToCart(item) {
  const i = cart.findIndex((it) => it.name === item.name && it.unit_price === item.unit_price);
  if (i >= 0) {
    cart[i].quantity += item.quantity || 1;
  } else {
    cart.push({ ...item, quantity: item.quantity || 1 });
  }
  renderCart();
}

async function fetchProducts(q = '') {
  const res = await fetch(`/api/products${q ? `?query=${encodeURIComponent(q)}` : ''}`);
  const data = await res.json();
  renderProducts(data);
}

async function addProduct() {
  const name = $('#new-name').value.trim();
  const price = Number($('#new-price').value || 0);
  const barcode = $('#new-barcode').value.trim() || undefined;
  if (!name) return alert('Nama wajib diisi');
  const res = await fetch('/api/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, price, barcode })
  });
  if (!res.ok) return alert('Gagal menambah produk');
  $('#new-name').value = '';
  $('#new-price').value = '';
  $('#new-barcode').value = '';
  fetchProducts('');
}

async function lookupBarcode() {
  const code = $('#barcode').value.trim();
  if (!code) return;
  const res = await fetch(`/api/barcode/${encodeURIComponent(code)}`);
  const data = await res.json();
  if (res.ok && data.product) {
    // prompt price if 0
    let price = 0;
    if (!data.product.price || data.product.price === 0) {
      const v = prompt('Masukkan harga IDR untuk produk ini:', '0');
      price = Number(v || 0);
    } else {
      price = data.product.price;
    }
    addToCart({ name: data.product.name, unit_price: price, quantity: 1, barcode: code });
  } else {
    alert(data.message || 'Produk tidak ditemukan');
  }
}

async function checkout() {
  if (cart.length === 0) return alert('Keranjang kosong');
  const paid = Number($('#paid').value || 0);
  const currency = $('#currency').value;
  const payload = { items: cart.map(({ name, unit_price, quantity, barcode }) => ({ name, unit_price, quantity, barcode })), currency, paid };
  const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return alert(data.message || 'Checkout gagal');
  $('#result').textContent = `Transaksi #${data.transaction.id} tersimpan. Kembalian: Rp ${data.transaction.change.toLocaleString('id-ID')}`;
  cart = [];
  renderCart();
  $('#paid').value = '';
}

// Bindings
$('#btn-search').addEventListener('click', () => fetchProducts($('#search').value.trim()));
$('#btn-add').addEventListener('click', addProduct);
$('#btn-scan').addEventListener('click', lookupBarcode);
$('#btn-checkout').addEventListener('click', checkout);
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-search').click(); });
$('#barcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-scan').click(); });
$('#paid').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-checkout').click(); });

// Init
fetchProducts();
renderCart();

