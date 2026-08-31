/* ==================================================
   KasirKu POS - Script utama
   Fix bug + Fitur baru + UX lebih baik
   ================================================== */

// ============== KONFIGURASI ==============
const API_URL =
  "https://script.google.com/macros/s/AKfycbzXUnFJChk3TP_CbZf6IJjTcsFrFZAZEZUOb38Y22UQsW3l9xXZJjT-aNO1AD-NU2FP/exec";

const STORAGE_KEYS = {
  SESSION: "pos_session",
  TOKEN: "pos_token",
  HISTORY: "pos_history",
  HELD: "pos_held",
  THEME: "pos_theme",
};

// ============== STATE ==============
let productsData = [];
let cart = [];
let currentCategory = "Semua";
let sessionData = null;
let lastSuccessTrx = null; // untuk tombol cetak di modal sukses
let currentHistoryFilter = "all";
let currentPaymentMethod = "cash";
let pendingConfirm = null; // untuk modal konfirmasi generic

// ============== UTILITAS ==============
const formatRupiah = (angka) => {
  if (typeof angka !== "number" || isNaN(angka)) angka = 0;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(angka);
};

const formatRupiahInput = (str) => {
  // Parse "1.500.000" atau "1500000" jadi number
  if (!str) return 0;
  const cleaned = String(str).replace(/[^0-9]/g, "");
  return parseInt(cleaned, 10) || 0;
};

const formatNumberInput = (value) => {
  // Format ke "1.500.000" untuk input display
  const num = formatRupiahInput(value);
  if (num === 0) return "";
  return num.toLocaleString("id-ID");
};

const parseNumber = (value) => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  return formatRupiahInput(String(value));
};

const escapeHTML = (str) => {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const generateTrxId = () => {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}${String(
    now.getMinutes()
  ).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `TRX-${ymd}-${time}`;
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
};

const debounce = (fn, wait = 250) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

const normalizeTimestamp = (ts) => {
  if (typeof ts === "number" && isFinite(ts)) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof ts === "string" && ts.trim() !== "") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
};

// ============== TOAST ==============
function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const icons = {
    success: "mdi:check-circle",
    error: "mdi:alert-circle",
    warning: "mdi:alert",
    info: "mdi:information",
  };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <iconify-icon icon="${icons[type] || icons.info}"></iconify-icon>
    <span class="toast-message">${escapeHTML(message)}</span>
    <button class="toast-close" aria-label="Tutup">
      <iconify-icon icon="mdi:close"></iconify-icon>
    </button>
  `;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector(".toast-close").addEventListener("click", remove);
  setTimeout(remove, duration);
}

// ============== KONFIRMASI MODAL (pengganti confirm()) ==============
function showConfirm({
  title = "Konfirmasi",
  message = "Apakah Anda yakin?",
  okText = "Ya",
  cancelText = "Batal",
  danger = false,
  icon = "alert",
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const iconEl = document.getElementById("confirm-icon");
    const titleEl = document.getElementById("confirm-title");
    const msgEl = document.getElementById("confirm-message");
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");

    const iconMap = {
      alert: "mdi:alert-circle-outline",
      danger: "mdi:delete-alert",
      success: "mdi:check-circle-outline",
      info: "mdi:information-outline",
    };

    iconEl.innerHTML = `<iconify-icon icon="${
      iconMap[icon] || iconMap.alert
    }"></iconify-icon>`;
    iconEl.className = `confirm-icon ${
      danger ? "danger" : icon === "success" ? "success" : ""
    }`;

    titleEl.textContent = title;
    msgEl.textContent = message;
    okBtn.innerHTML = `<iconify-icon icon="mdi:check"></iconify-icon> ${okText}`;
    cancelBtn.innerHTML = `<iconify-icon icon="mdi:close"></iconify-icon> ${cancelText}`;

    okBtn.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;

    const cleanup = (result) => {
      modal.classList.remove("active");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(result);
    };

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    modal.classList.add("active");
  });
}

// ============== TEMA (DARK/LIGHT) ==============
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.getElementById("theme-icon");
  if (icon) {
    icon.setAttribute(
      "icon",
      theme === "dark" ? "mdi:weather-sunny" : "mdi:weather-night"
    );
  }
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

function toggleDarkMode() {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
}

// ============== CONNECTION STATUS ==============
function updateConnectionStatus() {
  const indicator = document.getElementById("conn-indicator");
  const icon = document.getElementById("conn-icon");
  const text = document.getElementById("conn-text");
  if (!indicator) return;

  if (navigator.onLine) {
    indicator.classList.add("online");
    icon.setAttribute("icon", "mdi:wifi");
    text.textContent = "Online";
  } else {
    indicator.classList.remove("online");
    icon.setAttribute("icon", "mdi:wifi-off");
    text.textContent = "Offline";
  }
}

// ============== JAM HEADER ==============
function updateClock() {
  const el = document.getElementById("header-clock");
  if (!el) return;
  const now = new Date();
  const d = now.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const t = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  el.innerHTML = `<iconify-icon icon="mdi:clock-outline"></iconify-icon> ${d} ${t}`;
}

// ============== API CLIENT (TOKEN SESI) ==============
async function panggilAPI(payload, timeoutMs = 30000) {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ ...payload, token }),
      signal: controller.signal,
    });
    const result = await response.json();

    if (result.status === "unauthorized") {
      sesiKedaluwarsa();
      throw new Error("Sesi berakhir");
    }
    return result;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Server tidak merespons (timeout)");
    }
    if (err instanceof TypeError) {
      throw new Error("Gagal terhubung ke server");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sesiKedaluwarsa() {
  localStorage.removeItem(STORAGE_KEYS.SESSION);
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  sessionData = null;
  showToast("Sesi berakhir atau kedaluwarsa. Silakan login ulang.", "warning");
  setTimeout(() => location.reload(), 1500);
}

// ============== LOGIN & SESI ==============
async function prosesLogin() {
  const pinInput = document.getElementById("login-pin");
  const errorEl = document.getElementById("login-error");
  const btnLogin = document.getElementById("btn-login");
  const btnText = document.getElementById("btn-login-text");

  const pin = pinInput.value.trim();
  errorEl.textContent = "";

  if (pin === "") {
    errorEl.textContent = "PIN tidak boleh kosong";
    pinInput.focus();
    return;
  }
  if (!/^\d+$/.test(pin)) {
    errorEl.textContent = "PIN hanya boleh angka";
    pinInput.focus();
    return;
  }

  btnLogin.disabled = true;
  btnText.textContent = "Memverifikasi...";

  try {
    const result = await panggilAPI({ action: "login", pin });

    if (result.status === "success") {
      if (!result.token) {
        errorEl.textContent =
          "Backend belum diperbarui. Deploy ulang Code.gs versi terbaru.";
        return;
      }
      sessionData = result.data;
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(sessionData));
      localStorage.setItem(STORAGE_KEYS.TOKEN, result.token);

      document.getElementById("login-overlay").classList.remove("active");
      document.getElementById("admin-info").textContent =
        sessionData.nama_admin;

      showToast(`Selamat datang, ${sessionData.nama_admin}!`, "success");

      await Promise.all([ambilDataProduk(), ambilDataRiwayat()]);
    } else {
      errorEl.textContent = result.message || "PIN salah";
      pinInput.value = "";
      pinInput.focus();
      showToast(result.message || "Login gagal", "error");
    }
  } catch (error) {
    errorEl.textContent = error.message || "Gagal terhubung ke server";
    showToast(error.message || "Tidak bisa terhubung ke server.", "error");
  } finally {
    btnLogin.disabled = false;
    btnText.textContent = "Buka Toko";
  }
}

async function logout() {
  const ok = await showConfirm({
    title: "Keluar dari Toko?",
    message:
      "Sesi akan diakhiri. Transaksi yang belum di-sync akan tetap tersimpan di perangkat ini.",
    okText: "Ya, Keluar",
    cancelText: "Batal",
    danger: true,
    icon: "danger",
  });
  if (!ok) return;
  try {
    await panggilAPI({ action: "logout" }, 10000);
  } catch (err) {
    // Tetap keluar dari perangkat meskipun server tidak terjangkau
  }
  localStorage.removeItem(STORAGE_KEYS.SESSION);
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  location.reload();
}

// ============== PRODUK ==============
async function ambilDataProduk() {
  const grid = document.getElementById("product-grid");
  grid.innerHTML = `
    <div class="product-grid-loading" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      <iconify-icon icon="mdi:loading" class="spin" style="font-size: 32px;"></iconify-icon>
      <p style="margin-top: 8px;">Memuat produk...</p>
    </div>
  `;

  try {
    const result = await panggilAPI({ action: "getProducts" }, 45000);

    if (result.status === "success") {
      productsData = result.data || [];
      // Sanitasi data
      productsData = productsData.map((p) => ({
        id: String(p.id),
        name: String(p.name || "Tanpa Nama"),
        price: parseNumber(p.price),
        stock: parseInt(p.stock, 10) || 0,
        category: String(p.category || "Lainnya"),
      }));
      renderKategoriChips();
      renderProducts();
    } else {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">
          <iconify-icon icon="mdi:cloud-alert-outline" style="font-size: 40px;"></iconify-icon>
          <p>Gagal memuat produk: ${escapeHTML(result.message || "")}</p>
        </div>
      `;
      showToast("Gagal memuat produk", "error");
    }
  } catch (error) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">
        <iconify-icon icon="mdi:wifi-off" style="font-size: 40px;"></iconify-icon>
        <p>Gagal terhubung ke server</p>
        <button class="btn btn-primary" style="margin-top: 12px;" onclick="ambilDataProduk()">
          <iconify-icon icon="mdi:refresh"></iconify-icon> Coba Lagi
        </button>
      </div>
    `;
    if (error.message !== "Sesi berakhir") {
      showToast(error.message || "Tidak bisa terhubung ke server", "error");
    }
  }
}

function renderKategoriChips() {
  const container = document.getElementById("category-filters");
  if (!container) return;
  const categories = [
    "Semua",
    ...new Set(productsData.map((p) => p.category).filter(Boolean)),
  ];
  container.innerHTML = categories
    .map((cat) => {
      const icon = getCategoryIcon(cat);
      const active = cat === currentCategory ? "chip-active" : "";
      return `<button class="chip ${active}" data-cat="${escapeHTML(
        cat
      )}" onclick="filterKategori('${escapeHTML(cat)}')">
        <iconify-icon icon="${icon}"></iconify-icon> ${escapeHTML(cat)}
      </button>`;
    })
    .join("");
}

function getCategoryIcon(cat) {
  const lc = String(cat).toLowerCase();
  if (lc.includes("minum")) return "mdi:cup";
  if (lc.includes("makan") || lc.includes("food"))
    return "mdi:food-apple-outline";
  if (lc.includes("kebut") || lc.includes("sembako")) return "mdi:cart-outline";
  if (lc.includes("snack") || lc.includes("camil")) return "mdi:cookie-outline";
  if (lc.includes("obat") || lc.includes("medis")) return "mdi:pill";
  if (lc.includes("kosmet") || lc.includes("beauty")) return "mdi:lipstick";
  if (lc.includes("elektron")) return "mdi:cellphone";
  return "mdi:tag-outline";
}

function renderProducts(productsToRender = null) {
  const grid = document.getElementById("product-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const list = productsToRender || productsData;

  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <iconify-icon icon="mdi:package-variant" style="font-size: 48px; opacity: 0.4;"></iconify-icon>
        <p style="margin-top: 8px;">Tidak ada produk ditemukan</p>
      </div>
    `;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((product) => {
    const card = document.createElement("div");
    const isOut = product.stock <= 0;
    const isLow = product.stock > 0 && product.stock <= 5;

    card.className = `product-card ${isOut ? "out-of-stock" : ""}`;
    if (!isOut) {
      card.onclick = () => addToCart(product);
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
    }

    card.innerHTML = `
      <div class="product-category">${escapeHTML(product.category)}</div>
      <div class="product-name">${escapeHTML(product.name)}</div>
      <div class="product-price">${formatRupiah(product.price)}</div>
      <div class="product-stock ${isLow ? "stock-low" : ""}">
        <iconify-icon icon="${
          isOut
            ? "mdi:close-circle"
            : isLow
            ? "mdi:alert-circle"
            : "mdi:package-variant"
        }"></iconify-icon>
        ${
          isOut
            ? "Habis"
            : isLow
            ? `Sisa ${product.stock} (menipis)`
            : `Stok: ${product.stock}`
        }
      </div>
      ${
        !isOut
          ? `<div class="add-icon"><iconify-icon icon="mdi:plus"></iconify-icon></div>`
          : ""
      }
    `;
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

function filterKategori(kategori) {
  currentCategory = kategori;
  document.querySelectorAll(".chip[data-cat]").forEach((btn) => {
    btn.classList.toggle("chip-active", btn.dataset.cat === kategori);
  });
  filterProducts();
}

const filterProducts = () => {
  const keyword = (document.getElementById("search-bar").value || "")
    .toLowerCase()
    .trim();
  const clearBtn = document.getElementById("search-clear");
  if (clearBtn) clearBtn.classList.toggle("visible", keyword.length > 0);

  const filtered = productsData.filter((p) => {
    const matchKategori =
      currentCategory === "Semua" || p.category === currentCategory;
    const matchKeyword =
      !keyword ||
      p.name.toLowerCase().includes(keyword) ||
      p.category.toLowerCase().includes(keyword);
    return matchKategori && matchKeyword;
  });
  renderProducts(filtered);
};

function clearSearch() {
  document.getElementById("search-bar").value = "";
  filterProducts();
  document.getElementById("search-bar").focus();
}

// ============== KERANJANG ==============
function addToCart(product) {
  const existingItem = cart.find((item) => item.id === product.id);
  const currentQty = existingItem ? existingItem.qty : 0;

  if (currentQty >= product.stock) {
    showToast(`Stok ${product.name} tidak mencukupi`, "warning");
    return;
  }

  if (existingItem) {
    existingItem.qty += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty: 1,
    });
  }
  updateCartUI();
  showToast(`+ ${product.name}`, "info", 1500);
}

function changeQty(productId, amount) {
  const item = cart.find((i) => i.id === productId);
  if (!item) return;
  const productRef = productsData.find((p) => p.id === productId);

  if (amount > 0 && productRef && item.qty >= productRef.stock) {
    showToast("Stok maksimal tercapai", "warning");
    return;
  }

  item.qty += amount;
  if (item.qty <= 0) {
    cart = cart.filter((i) => i.id !== productId);
  }
  updateCartUI();
}

function removeFromCart(productId) {
  const item = cart.find((i) => i.id === productId);
  cart = cart.filter((i) => i.id !== productId);
  updateCartUI();
  if (item) showToast(`${item.name} dihapus dari keranjang`, "info", 1500);
}

async function clearCart() {
  if (cart.length === 0) return;
  const ok = await showConfirm({
    title: "Kosongkan Keranjang?",
    message: `Semua ${cart.length} item di keranjang akan dihapus.`,
    okText: "Ya, Kosongkan",
    danger: true,
  });
  if (!ok) return;
  cart = [];
  updateCartUI();
  showToast("Keranjang dikosongkan", "info");
}

function updateCartUI() {
  const cartContainer = document.getElementById("cart-items");
  const emptyEl = document.getElementById("empty-cart");
  const totalItemsEl = document.getElementById("total-items");
  const totalPriceEl = document.getElementById("total-price");
  const checkoutBtn = document.getElementById("checkout-btn");
  const clearBtn = document.getElementById("btn-clear-cart");
  const holdBtn = document.getElementById("btn-hold");
  const cartCount = document.getElementById("cart-count-display");
  const mobileBadge = document.getElementById("mobile-cart-badge");

  cartContainer.innerHTML = "";
  let totalItems = 0;
  let totalPrice = 0;

  cart.forEach((item) => {
    const subtotal = item.price * item.qty;
    totalItems += item.qty;
    totalPrice += subtotal;

    const li = document.createElement("li");
    li.className = "cart-item";
    li.innerHTML = `
      <div class="item-details">
        <div class="item-name">${escapeHTML(item.name)}</div>
        <div class="item-price">${formatRupiah(item.price)}</div>
        <div class="item-subtotal">${formatRupiah(subtotal)}</div>
      </div>
      <div class="item-controls">
        <button class="btn-qty icon-only" onclick="changeQty('${escapeHTML(
          item.id
        )}', -1)" title="Kurangi" aria-label="Kurangi">
          <iconify-icon icon="mdi:minus"></iconify-icon>
        </button>
        <span class="item-qty">${item.qty}</span>
        <button class="btn-qty icon-only" onclick="changeQty('${escapeHTML(
          item.id
        )}', 1)" title="Tambah" aria-label="Tambah">
          <iconify-icon icon="mdi:plus"></iconify-icon>
        </button>
      </div>
      <button class="btn-remove-item" onclick="removeFromCart('${escapeHTML(
        item.id
      )}')" title="Hapus dari keranjang" aria-label="Hapus dari keranjang">
        <iconify-icon icon="mdi:close"></iconify-icon>
      </button>
    `;
    cartContainer.appendChild(li);
  });

  totalItemsEl.textContent = totalItems;
  totalPriceEl.textContent = formatRupiah(totalPrice);
  checkoutBtn.disabled = cart.length === 0;
  if (clearBtn) clearBtn.disabled = cart.length === 0;
  if (holdBtn) holdBtn.disabled = cart.length === 0;
  if (cartCount) cartCount.textContent = cart.length;
  if (mobileBadge) mobileBadge.textContent = cart.length;
  if (emptyEl) emptyEl.classList.toggle("hidden", cart.length > 0);
}

function toggleCartDrawer() {
  const section = document.getElementById("cart-section");
  section.classList.toggle("cart-open");
}

// ============== CHECKOUT / PEMBAYARAN ==============
function prosesCheckout() {
  if (cart.length === 0) return;
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  document.getElementById("payment-total").textContent = formatRupiah(total);
  document.getElementById("transfer-amount").textContent = formatRupiah(total);
  document.getElementById("cash-amount").value = "";
  document.getElementById("payment-cash-display").textContent = "Rp 0";
  document.getElementById("payment-change").textContent = "Rp 0";
  document
    .getElementById("payment-change-row")
    .classList.remove("insufficient");
  document.getElementById("btn-confirm-payment").disabled = true;
  setPaymentMethod("cash");
  document.getElementById("payment-modal").classList.add("active");
  setTimeout(() => document.getElementById("cash-amount").focus(), 200);
}

function setPaymentMethod(method) {
  currentPaymentMethod = method;
  document.querySelectorAll(".method-tab").forEach((tab) => {
    tab.classList.toggle("method-active", tab.dataset.method === method);
  });
  document
    .getElementById("payment-cash-area")
    .classList.toggle("hidden", method !== "cash");
  document
    .getElementById("payment-qris-area")
    .classList.toggle("hidden", method !== "qris");
  document
    .getElementById("payment-transfer-area")
    .classList.toggle("hidden", method !== "transfer");

  // QRIS/Transfer: auto-confirm enabled, tidak perlu input cash
  const btnConfirm = document.getElementById("btn-confirm-payment");
  if (method === "qris" || method === "transfer") {
    btnConfirm.disabled = false;
  } else if (method === "cash") {
    hitungKembalian();
  }
}

function tutupPayment() {
  document.getElementById("payment-modal").classList.remove("active");
}

function hitungKembalian() {
  const cashInput = document.getElementById("cash-amount").value;
  const cash = formatRupiahInput(cashInput);
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const change = cash - total;

  document.getElementById("payment-cash-display").textContent =
    formatRupiah(cash);
  const changeRow = document.getElementById("payment-change-row");
  const changeEl = document.getElementById("payment-change");
  const btnConfirm = document.getElementById("btn-confirm-payment");

  if (cash >= total && total > 0) {
    changeEl.textContent = formatRupiah(change);
    changeRow.classList.remove("insufficient");
    btnConfirm.disabled = false;
  } else {
    changeEl.textContent =
      cash === 0 ? "Rp 0" : `Kurang ${formatRupiah(Math.abs(change))}`;
    changeRow.classList.add("insufficient");
    btnConfirm.disabled = true;
  }
}

function quickCash(amount) {
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cashInput = document.getElementById("cash-amount");
  if (amount === "exact") {
    cashInput.value = formatNumberInput(total);
  } else {
    cashInput.value = formatNumberInput(amount);
  }
  hitungKembalian();
}

function konfirmasiPembayaran() {
  if (cart.length === 0) return;
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  let cash = total;
  let change = 0;

  if (currentPaymentMethod === "cash") {
    cash = formatRupiahInput(document.getElementById("cash-amount").value);
    if (cash < total) {
      showToast("Uang tunai tidak cukup", "error");
      return;
    }
    change = cash - total;
  }

  const buyerNameInput = document.getElementById("buyer-name").value.trim();
  const buyerName = buyerNameInput === "" ? "Pelanggan" : buyerNameInput;

  const payload = {
    id: generateTrxId(),
    timestamp: new Date().toISOString(),
    timestampLocal: new Date().toLocaleString("id-ID"),
    buyerName,
    items: cart.map((c) => ({
      id: c.id,
      name: c.name,
      price: c.price,
      qty: c.qty,
    })),
    total,
    totalItem: cart.reduce((s, i) => s + i.qty, 0),
    cash,
    change,
    paymentMethod: currentPaymentMethod,
    isCompleted: true,
    isSynced: false,
  };

  // Kurangi stok di memory
  cart.forEach((cartItem) => {
    const product = productsData.find((p) => p.id === cartItem.id);
    if (product) product.stock = Math.max(0, product.stock - cartItem.qty);
  });

  simpanKeRiwayat(payload);
  lastSuccessTrx = payload;

  // Tutup modal payment, buka success
  tutupPayment();
  document.getElementById("success-trx-id").textContent = payload.id;
  document.getElementById("modal-total-items").textContent = payload.totalItem;
  document.getElementById("modal-total-price").textContent =
    formatRupiah(total);
  document.getElementById("success-cash").textContent = formatRupiah(cash);
  document.getElementById("success-change").textContent = formatRupiah(change);
  document.getElementById("success-modal").classList.add("active");

  cart = [];
  document.getElementById("buyer-name").value = "";
  filterKategori(currentCategory);
  updateCartUI();
  updateSyncUI();

  // Auto sync
  if (navigator.onLine) {
    setTimeout(() => sinkronisasiData(true), 500);
  }
}

function tutupModal() {
  document.getElementById("success-modal").classList.remove("active");
  lastSuccessTrx = null;
}

// ============== HOLD / TUNDA TRANSAKSI ==============
function holdTransaction() {
  if (cart.length === 0) return;
  const held = JSON.parse(localStorage.getItem(STORAGE_KEYS.HELD) || "[]");
  const payload = {
    id: "HLD-" + Date.now(),
    timestamp: new Date().toLocaleString("id-ID"),
    buyerName:
      document.getElementById("buyer-name").value.trim() || "Pelanggan",
    items: [...cart],
    total: cart.reduce((s, i) => s + i.price * i.qty, 0),
    totalItem: cart.reduce((s, i) => s + i.qty, 0),
  };
  held.unshift(payload);
  localStorage.setItem(STORAGE_KEYS.HELD, JSON.stringify(held));
  cart = [];
  document.getElementById("buyer-name").value = "";
  updateCartUI();
  updateHeldBadge();
  showToast("Transaksi ditahan", "success");
}

function updateHeldBadge() {
  const badge = document.getElementById("held-badge");
  if (!badge) return;
  const held = JSON.parse(localStorage.getItem(STORAGE_KEYS.HELD) || "[]");
  badge.textContent = held.length;
  badge.classList.toggle("hidden", held.length === 0);
}

function bukaHeld() {
  renderHeld();
  document.getElementById("held-modal").classList.add("active");
}

function tutupHeld() {
  document.getElementById("held-modal").classList.remove("active");
}

function renderHeld() {
  const held = JSON.parse(localStorage.getItem(STORAGE_KEYS.HELD) || "[]");
  const container = document.getElementById("held-list");
  if (!container) return;
  if (held.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        <iconify-icon icon="mdi:bookmark-off-outline" style="font-size: 40px; opacity: 0.4;"></iconify-icon>
        <p>Tidak ada transaksi yang ditahan</p>
      </div>
    `;
    return;
  }
  container.innerHTML = held
    .map(
      (h) => `
      <div class="held-card">
        <div>
          <div style="font-weight: 700;">${escapeHTML(h.buyerName)}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${
            h.totalItem
          } item • ${escapeHTML(h.timestamp)}</div>
          <div style="color: var(--primary); font-weight: 700; margin-top: 4px;">${formatRupiah(
            h.total
          )}</div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="btn btn-primary btn-sm" onclick="resumeHeld('${
            h.id
          }')" title="Lanjutkan">
            <iconify-icon icon="mdi:play"></iconify-icon>
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteHeld('${
            h.id
          }')" title="Hapus">
            <iconify-icon icon="mdi:trash-can"></iconify-icon>
          </button>
        </div>
      </div>
    `
    )
    .join("");
}

async function resumeHeld(id) {
  const held = JSON.parse(localStorage.getItem(STORAGE_KEYS.HELD) || "[]");
  const item = held.find((h) => h.id === id);
  if (!item) return;

  if (cart.length > 0) {
    const ok = await showConfirm({
      title: "Ganti Isi Keranjang?",
      message: `Keranjang saat ini berisi ${cart.length} item dan akan diganti dengan transaksi yang ditahan.`,
      okText: "Ya, Ganti",
      cancelText: "Batal",
      danger: true,
    });
    if (!ok) return;
  }

  let clamped = false;
  const restored = (item.items || [])
    .map((i) => {
      const restoredItem = { ...i };
      const product = productsData.find((p) => p.id === restoredItem.id);
      if (product && restoredItem.qty > product.stock) {
        restoredItem.qty = Math.max(0, product.stock);
        clamped = true;
      }
      return restoredItem;
    })
    .filter((i) => i.qty > 0);

  if (restored.length === 0) {
    localStorage.setItem(
      STORAGE_KEYS.HELD,
      JSON.stringify(held.filter((h) => h.id !== id))
    );
    renderHeld();
    updateHeldBadge();
    showToast(
      "Transaksi tidak bisa dilanjutkan: semua item kehabisan stok",
      "warning"
    );
    return;
  }

  cart = restored;
  document.getElementById("buyer-name").value =
    item.buyerName === "Pelanggan" ? "" : item.buyerName || "";
  const remaining = held.filter((h) => h.id !== id);
  localStorage.setItem(STORAGE_KEYS.HELD, JSON.stringify(remaining));
  updateCartUI();
  updateHeldBadge();
  tutupHeld();
  if (clamped) {
    showToast("Sebagian jumlah disesuaikan dengan stok terbaru", "warning");
  } else {
    showToast("Transaksi dilanjutkan", "success");
  }
}

async function deleteHeld(id) {
  const ok = await showConfirm({
    title: "Hapus Transaksi?",
    message: "Transaksi yang ditahan akan dihapus permanen.",
    danger: true,
    okText: "Hapus",
  });
  if (!ok) return;
  const held = JSON.parse(localStorage.getItem(STORAGE_KEYS.HELD) || "[]");
  localStorage.setItem(
    STORAGE_KEYS.HELD,
    JSON.stringify(held.filter((h) => h.id !== id))
  );
  renderHeld();
  updateHeldBadge();
}

// ============== RIWAYAT ==============
function simpanKeRiwayat(trx) {
  let history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]");
  history.unshift(trx);
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
}

function bukaHistory() {
  document.getElementById("history-search").value = "";
  currentHistoryFilter = "all";
  document
    .querySelectorAll(".history-filters .chip")
    .forEach((c) =>
      c.classList.toggle("chip-active", c.dataset.filter === "all")
    );
  renderHistory();
  document.getElementById("history-modal").classList.add("active");
}

function tutupHistory() {
  document.getElementById("history-modal").classList.remove("active");
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const search = (document.getElementById("history-search").value || "")
    .toLowerCase()
    .trim();
  const allHistory = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]"
  );

  let history = [...allHistory];
  const today = todayKey();

  // Filter
  if (currentHistoryFilter === "completed") {
    history = history.filter((h) => h.isCompleted);
  } else if (currentHistoryFilter === "pending") {
    history = history.filter((h) => !h.isCompleted);
  } else if (currentHistoryFilter === "today") {
    history = history.filter((h) => {
      const trxDate = new Date(h.timestamp);
      return (
        `${trxDate.getFullYear()}-${String(trxDate.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(trxDate.getDate()).padStart(2, "0")}` === today
      );
    });
  }

  // Search
  if (search) {
    history = history.filter(
      (h) =>
        (h.id || "").toLowerCase().includes(search) ||
        (h.buyerName || "").toLowerCase().includes(search) ||
        (h.items || []).some((i) =>
          (i.name || "").toLowerCase().includes(search)
        )
    );
  }

  if (history.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <iconify-icon icon="mdi:receipt-text-remove-outline" style="font-size: 48px; opacity: 0.4;"></iconify-icon>
        <p>Tidak ada riwayat ditemukan</p>
      </div>
    `;
    return;
  }

  list.innerHTML = history
    .map((trx) => {
      const isCompleted = !!trx.isCompleted;
      const isSynced = !!trx.isSynced;
      const cardClass = isCompleted ? "completed" : "pending";
      const itemsText = (trx.items || [])
        .map((i) => `${escapeHTML(i.name)} (x${i.qty})`)
        .join(", ");

      let statusHTML;
      if (!isCompleted) {
        statusHTML = `<span class="history-status status-pending"><iconify-icon icon="mdi:clock-outline"></iconify-icon> Belum Bayar</span>`;
      } else if (isSynced) {
        statusHTML = `<span class="history-status status-completed"><iconify-icon icon="mdi:check"></iconify-icon> Selesai</span>`;
      } else {
        statusHTML = `<span class="history-status status-pending"><iconify-icon icon="mdi:cloud-upload-outline"></iconify-icon> Belum Sync</span>`;
      }

      let bottomHTML;
      if (isCompleted) {
        bottomHTML = `
          <div class="history-actions">
            <button class="btn btn-outline btn-sm" onclick='showDetail(${JSON.stringify(
              trx
            ).replace(/'/g, "\\u0027")})'>
              <iconify-icon icon="mdi:eye-outline"></iconify-icon> Detail
            </button>
            <button class="btn btn-secondary btn-sm" onclick='cetakStruk(${JSON.stringify(
              trx
            ).replace(
              /'/g,
              "\\u0027"
            )})' style="background: #6c757d; color: white;">
              <iconify-icon icon="mdi:printer-outline"></iconify-icon> Cetak
            </button>
            ${
              !isSynced
                ? `<button class="btn btn-warning btn-sm" onclick="batalkanSelesai('${trx.id}')">
              <iconify-icon icon="mdi:undo"></iconify-icon> Batal
            </button>`
                : ""
            }
            <button class="btn btn-danger btn-sm" onclick="hapusSatuTransaksi('${
              trx.id
            }')">
              <iconify-icon icon="mdi:trash-can-outline"></iconify-icon> Hapus
            </button>
          </div>
          <div class="receipt-summary" style="margin-top: 10px;">
            <div class="receipt-row">
              <span><iconify-icon icon="mdi:cash"></iconify-icon> Tunai</span>
              <strong>${formatRupiah(trx.cash)}</strong>
            </div>
            <div class="receipt-row receipt-change">
              <span><iconify-icon icon="mdi:cash-refund"></iconify-icon> Kembali</span>
              <strong>${formatRupiah(trx.change)}</strong>
            </div>
          </div>
        `;
      } else {
        bottomHTML = `
          <div class="history-payment-area">
            <input type="text" id="cash-${trx.id}" placeholder="Input uang diterima (Rp)" oninput="hitungKembalianHistory('${trx.id}', ${trx.total})" />
            <div id="change-${trx.id}" class="history-change error">Belum ada input</div>
            <button class="btn btn-success btn-block" id="btn-complete-${trx.id}" onclick="selesaikanDiHistory('${trx.id}')" disabled>
              <iconify-icon icon="mdi:check-circle"></iconify-icon> Selesaikan
            </button>
          </div>
          <div class="history-actions">
            <button class="btn btn-danger btn-sm" onclick="hapusSatuTransaksi('${trx.id}')">
              <iconify-icon icon="mdi:trash-can-outline"></iconify-icon> Hapus
            </button>
          </div>
        `;
      }

      return `
        <div class="history-card ${cardClass}">
          <div class="history-header-row">
            <div class="history-meta">
              <div class="history-date"><iconify-icon icon="mdi:calendar"></iconify-icon> ${escapeHTML(
                trx.timestampLocal || trx.timestamp || "-"
              )}</div>
              <div class="history-id">${escapeHTML(trx.id)}</div>
              <div class="history-buyer"><iconify-icon icon="mdi:account"></iconify-icon> ${escapeHTML(
                trx.buyerName || "Pelanggan"
              )}</div>
            </div>
            ${statusHTML}
          </div>
          <div class="history-total">${formatRupiah(trx.total)}</div>
          <div class="history-items">${itemsText}</div>
          ${bottomHTML}
        </div>
      `;
    })
    .join("");
}

function showDetail(trx) {
  if (typeof trx === "string") trx = JSON.parse(trx);
  const body = document.getElementById("detail-body");
  if (!body) return;
  body.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">Informasi Transaksi</div>
      <div class="detail-row"><span>ID</span><strong>${escapeHTML(
        trx.id
      )}</strong></div>
      <div class="detail-row"><span>Tanggal</span><strong>${escapeHTML(
        trx.timestampLocal || trx.timestamp || "-"
      )}</strong></div>
      <div class="detail-row"><span>Pelanggan</span><strong>${escapeHTML(
        trx.buyerName || "-"
      )}</strong></div>
      <div class="detail-row"><span>Metode</span><strong>${escapeHTML(
        (trx.paymentMethod || "cash").toUpperCase()
      )}</strong></div>
      <div class="detail-row"><span>Status</span><strong>${
        trx.isCompleted ? "Selesai" : "Belum Bayar"
      }</strong></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Item</div>
      <ul class="detail-items-list">
        ${(trx.items || [])
          .map(
            (i) => `
          <li class="detail-item-row">
            <div>
              <div style="font-weight: 600;">${escapeHTML(i.name)}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${
                i.qty
              } × ${formatRupiah(i.price)}</div>
            </div>
            <strong>${formatRupiah(i.qty * i.price)}</strong>
          </li>
        `
          )
          .join("")}
      </ul>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Pembayaran</div>
      <div class="detail-row"><span>Total</span><strong style="color: var(--primary); font-size: 16px;">${formatRupiah(
        trx.total
      )}</strong></div>
      ${
        trx.isCompleted
          ? `
        <div class="detail-row"><span>Tunai</span><strong>${formatRupiah(
          trx.cash || 0
        )}</strong></div>
        <div class="detail-row"><span>Kembali</span><strong style="color: var(--success);">${formatRupiah(
          trx.change || 0
        )}</strong></div>
      `
          : ""
      }
    </div>
  `;
  document.getElementById("detail-modal").classList.add("active");
}

function tutupDetail() {
  document.getElementById("detail-modal").classList.remove("active");
}

function hitungKembalianHistory(id, totalBayar) {
  const cashInput = document.getElementById(`cash-${id}`).value;
  const cash = formatRupiahInput(cashInput);
  const changeDisplay = document.getElementById(`change-${id}`);
  const btnComplete = document.getElementById(`btn-complete-${id}`);

  if (cash >= totalBayar) {
    const kembalian = cash - totalBayar;
    changeDisplay.textContent = `Kembalian: ${formatRupiah(kembalian)}`;
    changeDisplay.className = "history-change success";
    btnComplete.disabled = false;
  } else {
    changeDisplay.textContent =
      cash === 0
        ? "Belum ada input"
        : `Kurang ${formatRupiah(totalBayar - cash)}`;
    changeDisplay.className = "history-change error";
    btnComplete.disabled = true;
  }
}

function selesaikanDiHistory(idTransaksi) {
  let history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]");
  const trxIndex = history.findIndex((t) => t.id === idTransaksi);
  if (trxIndex < 0) return;

  const cashInput = document.getElementById(`cash-${idTransaksi}`).value;
  const cash = formatRupiahInput(cashInput);
  const totalBayar = history[trxIndex].total;

  if (cash < totalBayar) {
    showToast("Uang tidak cukup", "error");
    return;
  }

  history[trxIndex].cash = cash;
  history[trxIndex].change = cash - totalBayar;
  history[trxIndex].isCompleted = true;
  history[trxIndex].isSynced = false;
  history[trxIndex].paymentMethod = "cash";
  history[trxIndex].timestamp =
    history[trxIndex].timestamp || new Date().toISOString();
  history[trxIndex].timestampLocal = new Date().toLocaleString("id-ID");

  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  renderHistory();
  updateSyncUI();
  showToast("Transaksi diselesaikan", "success");

  if (navigator.onLine) {
    setTimeout(() => sinkronisasiData(true), 500);
  }
}

function batalkanSelesai(idTransaksi) {
  let history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]");
  const trxIndex = history.findIndex((t) => t.id === idTransaksi);
  if (trxIndex < 0) return;

  if (history[trxIndex].isSynced) {
    showToast(
      "Transaksi sudah tersimpan di server. Gunakan tombol Hapus jika ingin membatalkannya.",
      "warning"
    );
    return;
  }

  history[trxIndex].isCompleted = false;
  history[trxIndex].cash = 0;
  history[trxIndex].change = 0;
  history[trxIndex].isSynced = false;
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  renderHistory();
  updateSyncUI();
  showToast("Status dibatalkan", "info");
}

async function hapusSatuTransaksi(idTransaksi) {
  let history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]");
  const trx = history.find((t) => t.id === idTransaksi);

  const pesanKonfirmasi =
    trx && !trx.isSynced
      ? "Transaksi lokal ini akan dihapus permanen."
      : "Transaksi akan dihapus permanen dari database, dan stok produknya dikembalikan.";

  const ok = await showConfirm({
    title: "Hapus Transaksi?",
    message: pesanKonfirmasi,
    okText: "Hapus",
    danger: true,
    icon: "danger",
  });
  if (!ok) return;

  // Hanya lokal, hapus langsung
  if (trx && !trx.isSynced) {
    history = history.filter((t) => t.id !== idTransaksi);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    renderHistory();
    updateSyncUI();
    if (navigator.onLine) ambilDataProduk();
    showToast("Transaksi dihapus", "success");
    return;
  }

  // Sudah di server, butuh internet
  if (!navigator.onLine) {
    showToast("Harus online untuk menghapus dari server", "warning");
    return;
  }

  try {
    const result = await panggilAPI({
      action: "deleteTransaction",
      trx_id: idTransaksi,
    });
    if (result.status === "success") {
      history = history.filter((t) => t.id !== idTransaksi);
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
      renderHistory();
      updateSyncUI();
      ambilDataProduk();
      showToast(result.message || "Transaksi dihapus dari server", "success");
    } else {
      showToast("Gagal: " + (result.message || ""), "error");
    }
  } catch (err) {
    if (err.message !== "Sesi berakhir") {
      showToast(err.message || "Koneksi ke server gagal", "error");
    }
  }
}

async function hapusHistory() {
  const ok = await showConfirm({
    title: "⚠️ Hapus Semua Riwayat?",
    message:
      "SEMUA transaksi di server akan dihapus permanen. Stok produk TIDAK akan dikembalikan. Tindakan ini tidak bisa dibatalkan!",
    okText: "Ya, Hapus Semua",
    cancelText: "Batal",
    danger: true,
    icon: "danger",
  });
  if (!ok) return;

  if (!navigator.onLine) {
    showToast("Harus online untuk menghapus dari server", "warning");
    return;
  }

  try {
    const result = await panggilAPI({ action: "deleteAllHistory" }, 90000);
    if (result.status === "success") {
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
      renderHistory();
      updateSyncUI();
      showToast("Semua riwayat dihapus", "success");
    } else {
      showToast("Gagal: " + (result.message || ""), "error");
    }
  } catch (err) {
    if (err.message !== "Sesi berakhir") {
      showToast(err.message || "Koneksi ke server gagal", "error");
    }
  }
}

function cetakStruk(trx) {
  if (typeof trx === "string") trx = JSON.parse(trx);
  const printArea = document.getElementById("print-area");
  if (!printArea) return;

  const itemsHTML = (trx.items || [])
    .map(
      (item) => `
      <div class="struk-item-name">${escapeHTML(item.name)}</div>
      <div class="struk-item-calc">
        <span>${item.qty} x ${formatRupiah(item.price)}</span>
        <span>${formatRupiah(item.qty * item.price)}</span>
      </div>
    `
    )
    .join("");

  const methodMap = { cash: "TUNAI", qris: "QRIS", transfer: "TRANSFER" };

  printArea.innerHTML = `
    <div class="struk-header">
      <strong>${escapeHTML(
        sessionData ? sessionData.nama_admin : "TOKO KITA"
      )}</strong><br>
      Bukti Pembayaran
    </div>
    <div class="struk-info">
      Tgl : ${escapeHTML(trx.timestampLocal || trx.timestamp || "-")}<br>
      ID  : ${escapeHTML(trx.id)}<br>
      Plg : ${escapeHTML(trx.buyerName || "Pelanggan")}<br>
      Byr : ${methodMap[trx.paymentMethod] || "TUNAI"}
    </div>
    <div class="struk-divider"></div>
    ${itemsHTML}
    <div class="struk-divider"></div>
    <div class="struk-item struk-total">
      <span>TOTAL</span>
      <span>${formatRupiah(trx.total)}</span>
    </div>
    <div class="struk-item">
      <span>Tunai</span>
      <span>${formatRupiah(trx.cash || 0)}</span>
    </div>
    <div class="struk-item">
      <span>Kembali</span>
      <span>${formatRupiah(trx.change || 0)}</span>
    </div>
    <div class="struk-footer">
      Terima Kasih Atas<br>Kunjungan Anda
    </div>
  `;
  window.print();
}

// ============== EXPORT / IMPORT ==============
function exportHistory() {
  const history = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]"
  );
  if (history.length === 0) {
    showToast("Tidak ada data untuk di-export", "warning");
    return;
  }
  const blob = new Blob([JSON.stringify(history, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pos-history-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("History berhasil di-export", "success");
}

function importHistory() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Format file tidak valid");

      const valid = data.filter(
        (t) => t && typeof t === "object" && t.id && Array.isArray(t.items)
      );
      if (valid.length === 0) {
        showToast("File tidak berisi transaksi yang valid", "error");
        return;
      }

      const existing = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]"
      );
      const existingIds = new Set(existing.map((t) => t.id));
      const newOnly = valid.filter((t) => !existingIds.has(t.id));
      if (newOnly.length === 0) {
        showToast("Semua transaksi dalam file sudah ada di riwayat", "info");
        return;
      }

      const ok = await showConfirm({
        title: "Import History?",
        message: `${newOnly.length} transaksi baru akan ditambahkan (${
          data.length - newOnly.length
        } duplikat dilewati).`,
        okText: "Import",
      });
      if (!ok) return;

      const merged = [...newOnly, ...existing];
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(merged));
      renderHistory();
      updateSyncUI();
      showToast(`${newOnly.length} transaksi berhasil di-import`, "success");
    } catch (err) {
      showToast("File tidak valid: " + err.message, "error");
    }
  };
  input.click();
}

// ============== SINKRONISASI ==============
function updateSyncUI() {
  const history = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]"
  );
  const pendingSync = history.filter(
    (trx) => trx.isCompleted && !trx.isSynced
  ).length;
  const syncBtn = document.getElementById("btn-sync");
  if (!syncBtn) return;

  if (pendingSync > 0) {
    syncBtn.classList.remove("all-synced");
    syncBtn.querySelector("span:not(.badge)").textContent = "Sync";
    syncBtn.querySelector(".badge").textContent = pendingSync;
    syncBtn.querySelector(".badge").classList.remove("hidden");
  } else {
    syncBtn.classList.add("all-synced");
    syncBtn.querySelector("span:not(.badge)").textContent = "Tersinkron";
    syncBtn.querySelector(".badge").classList.add("hidden");
  }

  updateRevenueUI();
}

function updateRevenueUI() {
  const history = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]"
  );
  const today = todayKey();

  let todayTotal = 0;
  let todayCount = 0;

  history.forEach((trx) => {
    if (!trx.isCompleted) return;
    const trxDate = new Date(trx.timestamp);
    const trxKey = `${trxDate.getFullYear()}-${String(
      trxDate.getMonth() + 1
    ).padStart(2, "0")}-${String(trxDate.getDate()).padStart(2, "0")}`;
    if (trxKey === today) {
      todayTotal += trx.total;
      todayCount += 1;
    }
  });

  const revEl = document.getElementById("today-revenue");
  const countEl = document.getElementById("today-count");
  if (revEl) revEl.textContent = formatRupiah(todayTotal);
  if (countEl) countEl.textContent = todayCount;
}

async function sinkronisasiData(isAuto = false) {
  if (!navigator.onLine) {
    if (!isAuto) showToast("Tidak ada koneksi internet", "warning");
    return;
  }

  const history = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]"
  );
  const pendingTransactions = history.filter(
    (trx) => trx.isCompleted && !trx.isSynced
  );

  if (pendingTransactions.length === 0) {
    if (!isAuto) showToast("Semua transaksi sudah tersinkron", "success");
    return;
  }

  const syncBtn = document.getElementById("btn-sync");
  if (syncBtn) {
    syncBtn.disabled = true;
    const textSpan = syncBtn.querySelector("span:not(.badge)");
    if (textSpan)
      textSpan.textContent = isAuto ? "Auto-sync..." : "Mengirim...";
  }

  try {
    const result = await panggilAPI(
      { action: "syncTransactions", transactions: pendingTransactions },
      60000
    );

    if (result.status === "success") {
      const updated = history.map((trx) =>
        trx.isCompleted && !trx.isSynced ? { ...trx, isSynced: true } : trx
      );
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(updated));
      renderHistory();
      updateSyncUI();
      ambilDataProduk(); // rekonsiliasi stok dengan server
      if (!isAuto)
        showToast(
          `Berhasil sync ${pendingTransactions.length} transaksi`,
          "success"
        );
    } else {
      if (!isAuto) showToast("Gagal sync: " + (result.message || ""), "error");
    }
  } catch (err) {
    if (!isAuto && err.message !== "Sesi berakhir") {
      showToast(err.message || "Koneksi ke server gagal", "error");
    }
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      updateSyncUI();
    }
  }
}

async function ambilDataRiwayat() {
  try {
    const result = await panggilAPI({ action: "getHistory" }, 45000);

    if (result.status === "success") {
      const serverHistory = (result.data || [])
        .slice()
        .reverse()
        .map((trx) => ({
          ...trx,
          timestamp: normalizeTimestamp(trx.timestamp),
        }));
      const localHistory = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.HISTORY) || "[]"
      );
      // Simpan hanya record lokal yang belum tersync dan belum ada di server
      const serverIds = new Set(serverHistory.map((t) => t.id));
      const pendingFiltered = localHistory.filter(
        (trx) => !trx.isSynced && !serverIds.has(trx.id)
      );
      const combinedHistory = [...pendingFiltered, ...serverHistory].sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      );
      localStorage.setItem(
        STORAGE_KEYS.HISTORY,
        JSON.stringify(combinedHistory)
      );
      updateSyncUI();
      if (
        document.getElementById("history-modal").classList.contains("active")
      ) {
        renderHistory();
      }
    }
  } catch (err) {
    console.log("Gagal menarik riwayat:", err);
  }
}

// ============== KEYBOARD SHORTCUTS ==============
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // F2 → fokus search
    if (e.key === "F2") {
      e.preventDefault();
      document.getElementById("search-bar")?.focus();
    }
    // Escape → tutup modal
    if (e.key === "Escape") {
      [
        "payment-modal",
        "success-modal",
        "history-modal",
        "held-modal",
        "detail-modal",
        "confirm-modal",
        "login-overlay",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.classList.contains("active") && id !== "login-overlay") {
          el.classList.remove("active");
        }
      });
    }
    // Ctrl+Enter → checkout (jika cart tidak kosong dan tidak di modal)
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (cart.length > 0 && !document.querySelector(".modal-overlay.active")) {
        e.preventDefault();
        prosesCheckout();
      }
    }
  });

  // Cash input formatting
  const cashInput = document.getElementById("cash-amount");
  if (cashInput) {
    cashInput.addEventListener("input", (e) => {
      const cursorPos = e.target.selectionStart;
      const oldLength = e.target.value.length;
      e.target.value = formatNumberInput(e.target.value);
      const newLength = e.target.value.length;
      const newPos = cursorPos + (newLength - oldLength);
      e.target.setSelectionRange(newPos, newPos);
      hitungKembalian();
    });
  }

  // History search
  const historySearch = document.getElementById("history-search");
  if (historySearch) {
    historySearch.addEventListener("input", debounce(renderHistory, 200));
  }

  // Search bar
  const searchBar = document.getElementById("search-bar");
  if (searchBar) {
    searchBar.addEventListener("input", debounce(filterProducts, 100));
  }

  // PIN input
  const pinInput = document.getElementById("login-pin");
  if (pinInput) {
    pinInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") prosesLogin();
    });
  }

  // History filter chips
  document.querySelectorAll(".history-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document
        .querySelectorAll(".history-filters .chip")
        .forEach((c) => c.classList.remove("chip-active"));
      chip.classList.add("chip-active");
      currentHistoryFilter = chip.dataset.filter;
      renderHistory();
    });
  });

  // Payment method tabs
  document.querySelectorAll(".method-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setPaymentMethod(tab.dataset.method);
    });
  });

  // Quick cash buttons
  document.querySelectorAll(".quick-cash-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "exact") {
        quickCash("exact");
      } else {
        quickCash(parseInt(btn.dataset.amount, 10));
      }
    });
  });

  // Print after success
  const printBtn = document.getElementById("btn-print-after-success");
  if (printBtn) {
    printBtn.addEventListener("click", () => {
      if (lastSuccessTrx) cetakStruk(lastSuccessTrx);
    });
  }

  // Click backdrop to close modals
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && overlay.id !== "login-overlay") {
        overlay.classList.remove("active");
      }
    });
  });
}

// ============== INISIALISASI ==============
function init() {
  // Load tema
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "light";
  applyTheme(savedTheme);

  // Setup semua event
  setupKeyboardShortcuts();
  updateConnectionStatus();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateRevenueUI, 60000); // update statistik tiap menit

  window.addEventListener("online", () => {
    updateConnectionStatus();
    showToast("Kembali online", "success");
    sinkronisasiData(true);
  });
  window.addEventListener("offline", () => {
    updateConnectionStatus();
    showToast("Anda offline. Data akan di-sync saat online.", "warning");
  });

  // Restore session
  sessionData = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION));
  if (sessionData) {
    document.getElementById("login-overlay").classList.remove("active");
    document.getElementById("admin-info").textContent = sessionData.nama_admin;
    ambilDataProduk();
    ambilDataRiwayat();
  } else {
    document.getElementById("login-overlay").classList.add("active");
    setTimeout(() => document.getElementById("login-pin")?.focus(), 300);
  }
  updateSyncUI();
  updateHeldBadge();
}

// Expose ke global
window.prosesLogin = prosesLogin;
window.logout = logout;
window.ambilDataProduk = ambilDataProduk;
window.filterKategori = filterKategori;
window.filterProducts = filterProducts;
window.clearSearch = clearSearch;
window.addToCart = addToCart;
window.changeQty = changeQty;
window.removeFromCart = removeFromCart;
window.clearCart = clearCart;
window.updateCartUI = updateCartUI;
window.toggleCartDrawer = toggleCartDrawer;
window.prosesCheckout = prosesCheckout;
window.tutupPayment = tutupPayment;
window.hitungKembalian = hitungKembalian;
window.quickCash = quickCash;
window.konfirmasiPembayaran = konfirmasiPembayaran;
window.tutupModal = tutupModal;
window.holdTransaction = holdTransaction;
window.bukaHeld = bukaHeld;
window.tutupHeld = tutupHeld;
window.resumeHeld = resumeHeld;
window.deleteHeld = deleteHeld;
window.bukaHistory = bukaHistory;
window.tutupHistory = tutupHistory;
window.renderHistory = renderHistory;
window.showDetail = showDetail;
window.tutupDetail = tutupDetail;
window.hitungKembalianHistory = hitungKembalianHistory;
window.selesaikanDiHistory = selesaikanDiHistory;
window.batalkanSelesai = batalkanSelesai;
window.hapusSatuTransaksi = hapusSatuTransaksi;
window.hapusHistory = hapusHistory;
window.cetakStruk = cetakStruk;
window.exportHistory = exportHistory;
window.importHistory = importHistory;
window.sinkronisasiData = sinkronisasiData;
window.toggleDarkMode = toggleDarkMode;
window.showConfirm = showConfirm;
window.showToast = showToast;

document.addEventListener("DOMContentLoaded", init);
