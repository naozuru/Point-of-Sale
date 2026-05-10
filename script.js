// ================= KONFIGURASI API =================
const API_URL =
  "https://script.google.com/macros/s/AKfycbx60WewyRsl1Z6nf69_cxU8oyeo68fkLB4FxKKfQGBEGTq0bTcUSwH6kX8CBPsoFmw/exec"; // MASUKKAN URL GOOGLE APPS SCRIPT DI SINI

// State Global
let productsData = []; // Data akan kosong di awal, ditarik dari Spreadsheet
let cart = [];
let currentCategory = "Semua";

// Cek Sesi Login di Local Storage
let sessionData = JSON.parse(localStorage.getItem("pos_session"));

// Format angka ke Rupiah
const formatRupiah = (angka) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(angka);
};

// ================= FITUR LOGIN & SESI =================

// Fungsi saat tombol login ditekan
async function prosesLogin() {
  const pinInput = document.getElementById("login-pin").value;
  const btnLogin = document.getElementById("btn-login");

  if (pinInput.trim() === "") {
    alert("PIN tidak boleh kosong!");
    return;
  }

  btnLogin.disabled = true;
  btnLogin.innerText = "Memverifikasi...";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "login", pin: pinInput }),
    });
    const result = await response.json();

    if (result.status === "success") {
      // Simpan data admin ke Local Storage
      sessionData = result.data;
      localStorage.setItem("pos_session", JSON.stringify(sessionData));

      // Sembunyikan layar login dan muat data produk
      document.getElementById("login-overlay").classList.remove("active");
      document.getElementById("admin-info").innerText = sessionData.nama_admin;
      ambilDataProduk();
      ambilDataRiwayat();
    } else {
      alert(result.message);
      btnLogin.disabled = false;
      btnLogin.innerText = "Buka Toko";
    }
  } catch (error) {
    alert(
      "Gagal terhubung ke server. Pastikan URL Apps Script benar dan internet aktif."
    );
    btnLogin.disabled = false;
    btnLogin.innerText = "Buka Toko";
  }
}

// Fungsi keluar aplikasi
function logout() {
  if (confirm("Apakah Anda yakin ingin keluar dari cabang ini?")) {
    localStorage.removeItem("pos_session");
    localStorage.removeItem('pos_history');
    location.reload(); // Muat ulang halaman agar kembali ke layar login
  }
}

// ================= FITUR PRODUK (FETCH DARI SPREADSHEET) =================

async function ambilDataProduk() {
  const grid = document.getElementById("product-grid");
  grid.innerHTML =
    '<p style="padding:20px; text-align:center; width:100%;">Mendownload data produk dari database...</p>';

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "getProducts",
        id_admin: sessionData.id_admin,
      }),
    });
    const result = await response.json();

    if (result.status === "success") {
      productsData = result.data;
      renderProducts();
    } else {
      grid.innerHTML = `<p style="color:red; text-align:center; width:100%;">Gagal memuat produk: ${result.message}</p>`;
    }
  } catch (error) {
    grid.innerHTML =
      '<p style="color:red; text-align:center; width:100%;">Gagal terhubung ke database.</p>';
  }
}

function renderProducts(productsToRender = productsData) {
  const grid = document.getElementById("product-grid");
  grid.innerHTML = "";

  if (productsToRender.length === 0) {
    grid.innerHTML =
      '<p style="text-align:center; width:100%; margin-top:20px; color:#888;">Tidak ada produk.</p>';
    return;
  }

  productsToRender.forEach((product) => {
    const card = document.createElement("div");

    if (product.stock <= 0) {
      card.className = "product-card out-of-stock";
      card.innerHTML = `
                <div class="product-name">${product.name}</div>
                <div class="product-price">${formatRupiah(product.price)}</div>
                <div class="product-stock" style="color:red;">Habis</div>
            `;
    } else {
      card.className = "product-card";
      card.onclick = () => addToCart(product);
      card.innerHTML = `
                <div class="product-name">${product.name}</div>
                <div class="product-price">${formatRupiah(product.price)}</div>
                <div class="product-stock">Sisa Stok: ${product.stock}</div>
            `;
    }
    grid.appendChild(card);
  });
}

function filterKategori(kategori) {
  currentCategory = kategori;
  document.querySelectorAll(".btn-category").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.innerText === kategori) btn.classList.add("active");
  });
  filterProducts();
}

function filterProducts() {
  const keyword = document.getElementById("search-bar").value.toLowerCase();
  const filtered = productsData.filter((p) => {
    const matchKategori =
      currentCategory === "Semua" || p.category === currentCategory;
    const matchKeyword = p.name.toLowerCase().includes(keyword);
    return matchKategori && matchKeyword;
  });
  renderProducts(filtered);
}

// ================= FITUR KERANJANG =================

function addToCart(product) {
  const existingItem = cart.find((item) => item.id === product.id);
  const currentQty = existingItem ? existingItem.qty : 0;

  if (currentQty < product.stock) {
    if (existingItem) {
      existingItem.qty += 1;
    } else {
      cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
  } else {
    alert("Stok di database tidak mencukupi!");
  }
}

function changeQty(productId, amount) {
  const item = cart.find((item) => item.id === productId);
  const productRef = productsData.find((p) => p.id === productId);

  if (item) {
    if (amount > 0 && item.qty >= productRef.stock) {
      alert("Maksimal stok tercapai!");
      return;
    }
    item.qty += amount;
    if (item.qty <= 0) {
      cart = cart.filter((i) => i.id !== productId);
    }
    updateCartUI();
  }
}

function updateCartUI() {
  const cartContainer = document.getElementById("cart-items");
  const totalItemsEl = document.getElementById("total-items");
  const totalPriceEl = document.getElementById("total-price");
  const checkoutBtn = document.getElementById("checkout-btn");

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
                <div style="font-weight: 600; font-size: 14px;">${
                  item.name
                }</div>
                <div style="color: #666; font-size: 13px;">${formatRupiah(
                  item.price
                )}</div>
            </div>
            <div class="item-controls">
                <button class="btn-qty" onclick="changeQty('${
                  item.id
                }', -1)">-</button>
                <span>${item.qty}</span>
                <button class="btn-qty" onclick="changeQty('${
                  item.id
                }', 1)">+</button>
            </div>
        `;
    cartContainer.appendChild(li);
  });

  totalItemsEl.innerText = totalItems;
  totalPriceEl.innerText = formatRupiah(totalPrice);
  checkoutBtn.disabled = cart.length === 0;
}

function prosesCheckout() {
  if (cart.length === 0) return;

  const totalBiaya = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const totalItem = cart.reduce((sum, item) => sum + item.qty, 0);

  const buyerNameInput = document.getElementById("buyer-name").value.trim();
  const buyerName = buyerNameInput === "" ? "Anonim" : buyerNameInput;

  const payload = {
    id: "TRX-" + Date.now(),
    timestamp: new Date().toLocaleString("id-ID"),
    buyerName: buyerName,
    items: [...cart],
    total: totalBiaya,
    totalItem: totalItem,
    cash: 0,
    change: 0,
    isCompleted: false,
    isSynced: false,
  };

  // Kurangi stok di memory sementara agar UI langsung update tanpa loading
  cart.forEach((cartItem) => {
    const product = productsData.find((p) => p.id === cartItem.id);
    if (product) product.stock -= cartItem.qty;
  });

  simpanKeRiwayat(payload);

  document.getElementById("modal-total-items").innerText = totalItem;
  document.getElementById("modal-total-price").innerText =
    formatRupiah(totalBiaya);
  document.getElementById("success-modal").classList.add("active");

  cart = [];
  document.getElementById("buyer-name").value = "";
  filterKategori(currentCategory);
  updateCartUI();
  updateSyncUI();
}

function tutupModal() {
  document.getElementById("success-modal").classList.remove("active");
}

// ================= FITUR RIWAYAT TRANSAKSI =================

function simpanKeRiwayat(trx) {
  let history = JSON.parse(localStorage.getItem("pos_history")) || [];
  history.unshift(trx);
  localStorage.setItem("pos_history", JSON.stringify(history));
}

function bukaHistory() {
  renderHistory();
  document.getElementById("history-modal").classList.add("active");
}

function tutupHistory() {
  document.getElementById("history-modal").classList.remove("active");
}

function renderHistory() {
  const historyList = document.getElementById("history-list");
  const history = JSON.parse(localStorage.getItem("pos_history")) || [];

  historyList.innerHTML = "";

  if (history.length === 0) {
    historyList.innerHTML =
      '<p style="text-align:center; color:#888; margin-top:20px;">Belum ada riwayat transaksi.</p>';
    return;
  }

  history.forEach((trx) => {
    const itemsText = trx.items.map((i) => `${i.name} (x${i.qty})`).join(", ");
    const isCompleted = trx.isCompleted ? true : false;
    const cardClass = isCompleted ? "history-card completed" : "history-card";

    let syncLabelHTML = "";
    if (isCompleted) {
      syncLabelHTML = trx.isSynced
        ? `<span class="sync-status-label status-synced">✓ Tersinkronisasi</span>`
        : `<span class="sync-status-label status-pending">⏳ Belum Sync</span>`;
    }

    let areaBawahHTML = isCompleted
      ? `
                <div class="history-actions">
                    <button class="btn-print" onclick='cetakStruk(${JSON.stringify(
                      trx
                    )})'>Cetak Struk</button>
                    <button class="btn-delete-single" onclick="hapusSatuTransaksi('${
                      trx.id
                    }')">Hapus</button>
                </div>
                <div class="history-payment-info">
                    <div>Tunai: ${formatRupiah(trx.cash)}</div>
                    <div>Kembali: ${formatRupiah(trx.change)}</div>
                </div>
                <button class="btn-cancel-complete" style="width:100%; margin-top:8px;" onclick="batalkanSelesai('${
                  trx.id
                }')">Batal Selesai</button>
            `
      : `
                <div class="history-actions">
                    <button class="btn-print" onclick='cetakStruk(${JSON.stringify(
                      trx
                    )})'>Cetak Tagihan</button>
                    <button class="btn-delete-single" onclick="hapusSatuTransaksi('${
                      trx.id
                    }')">Hapus</button>
                </div>
                <div class="history-payment-area">
                    <input type="number" id="cash-${
                      trx.id
                    }" placeholder="Input Uang Diterima (Rp)" oninput="hitungKembalianHistory('${
          trx.id
        }', ${trx.total})">
                    <div id="change-${
                      trx.id
                    }" class="history-change">Kembalian: -</div>
                    <button class="btn-complete-single" id="btn-complete-${
                      trx.id
                    }" onclick="selesaikanDiHistory('${
          trx.id
        }')" disabled>Selesaikan Pesanan</button>
                </div>
            `;

    const card = document.createElement("div");
    card.className = cardClass;
    card.innerHTML = `
            <div class="history-header-row">
                <span class="history-date">${trx.timestamp}</span>
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span class="history-id">${trx.id}</span>
                    <div style="margin-top: 4px;">${syncLabelHTML}</div>
                </div>
            </div>
            <div style="font-size: 14px; margin-bottom: 5px; color: #333;">
                <strong>Pelanggan:</strong> ${trx.buyerName}
            </div>
            <div class="history-total">${formatRupiah(trx.total)}</div>
            <div class="history-items">${itemsText}</div>
            ${areaBawahHTML}
        `;
    historyList.appendChild(card);
  });
}

function hitungKembalianHistory(id, totalBayar) {
  const cashInput = document.getElementById(`cash-${id}`).value;
  const changeDisplay = document.getElementById(`change-${id}`);
  const btnComplete = document.getElementById(`btn-complete-${id}`);

  if (cashInput >= totalBayar) {
    const kembalian = cashInput - totalBayar;
    changeDisplay.innerText = `Kembalian: ${formatRupiah(kembalian)}`;
    changeDisplay.className = "history-change success";
    btnComplete.disabled = false;
  } else {
    changeDisplay.innerText = "Uang Kurang!";
    changeDisplay.className = "history-change error";
    btnComplete.disabled = true;
  }
}

function selesaikanDiHistory(idTransaksi) {
  let history = JSON.parse(localStorage.getItem("pos_history")) || [];
  let trxIndex = history.findIndex((t) => t.id === idTransaksi);

  if (trxIndex > -1) {
    const cashInput = parseInt(
      document.getElementById(`cash-${idTransaksi}`).value
    );
    const totalBayar = history[trxIndex].total;

    if (cashInput >= totalBayar) {
      history[trxIndex].cash = cashInput;
      history[trxIndex].change = cashInput - totalBayar;
      history[trxIndex].isCompleted = true;
      history[trxIndex].isSynced = false;

      localStorage.setItem("pos_history", JSON.stringify(history));
      renderHistory();
      updateSyncUI();

      // Auto-Sync Otomatis ke Database
      if (navigator.onLine) sinkronisasiData(true);
    }
  }
}

function batalkanSelesai(idTransaksi) {
  let history = JSON.parse(localStorage.getItem("pos_history")) || [];
  let trxIndex = history.findIndex((t) => t.id === idTransaksi);

  if (trxIndex > -1) {
    history[trxIndex].isCompleted = false;
    history[trxIndex].cash = 0;
    history[trxIndex].change = 0;
    history[trxIndex].isSynced = false;

    localStorage.setItem("pos_history", JSON.stringify(history));
    renderHistory();
    updateSyncUI();
  }
}

async function hapusSatuTransaksi(idTransaksi) {
    if (!confirm("Apakah Anda yakin ingin menghapus transaksi ini dari database secara permanen?")) return;

    // 1. Cek apakah transaksi belum tersinkronisasi (hanya ada di lokal)
    let history = JSON.parse(localStorage.getItem("pos_history")) || [];
    let trx = history.find(t => t.id === idTransaksi);
    
    if (trx && !trx.isSynced) {
        // Jika belum masuk Spreadsheet, hapus saja dari browser lokal
        history = history.filter(t => t.id !== idTransaksi);
        localStorage.setItem("pos_history", JSON.stringify(history));
        renderHistory();
        updateSyncUI();
        return;
    }

    // 2. Jika sudah disinkronisasi, tembak API untuk menghapus di Spreadsheet
    if (!navigator.onLine) {
        alert("Anda harus terhubung ke internet untuk menghapus data di database Spreadsheet.");
        return;
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "deleteTransaction",
                id_admin: sessionData.id_admin,
                trx_id: idTransaksi
            })
        });
        const result = await response.json();

        if (result.status === "success") {
            // Hapus dari tampilan lokal juga
            history = history.filter(t => t.id !== idTransaksi);
            localStorage.setItem("pos_history", JSON.stringify(history));
            renderHistory();
            updateSyncUI();
            alert("Berhasil: Transaksi dihapus dari Google Sheets.");
        } else {
            alert("Gagal menghapus: " + result.message);
        }
    } catch (error) {
        alert("Koneksi ke server gagal.");
    }
}

async function hapusHistory() {
    if (!confirm("PERINGATAN KERAS: Ini akan menghapus SEMUA transaksi toko Anda dari Spreadsheet. Data tidak dapat dikembalikan! Lanjutkan?")) return;
    
    if (!navigator.onLine) {
        alert("Anda harus terhubung ke internet untuk menghapus semua data di database.");
        return;
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "deleteAllHistory",
                id_admin: sessionData.id_admin
            })
        });
        const result = await response.json();

        if (result.status === "success") {
            // Bersihkan tampilan lokal
            localStorage.removeItem("pos_history");
            renderHistory();
            updateSyncUI();
            alert("Berhasil: Semua riwayat transaksi dihapus dari Google Sheets.");
        } else {
            alert("Gagal menghapus: " + result.message);
        }
    } catch (error) {
        alert("Koneksi ke server gagal.");
    }
}

function cetakStruk(trx) {
  if (typeof trx === "string") trx = JSON.parse(trx);
  const printArea = document.getElementById("print-area");
  let itemsHTML = "";

  trx.items.forEach((item) => {
    itemsHTML += `
            <div class="struk-item-name">${item.name}</div>
            <div class="struk-item-calc">
                <span>${item.qty} x ${item.price}</span>
                <span>${item.qty * item.price}</span>
            </div>
        `;
  });

  printArea.innerHTML = `
        <div class="struk-header">
            <strong>${
              sessionData ? sessionData.nama_admin : "TOKO KITA"
            }</strong><br>
            Bukti Pembayaran
        </div>
        <div class="struk-info">
            Waktu: ${trx.timestamp}<br>
            ID: ${trx.id}<br>
            Pelanggan: ${trx.buyerName}
        </div>
        <div class="struk-divider"></div>
        ${itemsHTML}
        <div class="struk-divider"></div>
        <div class="struk-item struk-total">
            <span>Total:</span>
            <span>${trx.total}</span>
        </div>
        <div class="struk-item">
            <span>Tunai:</span>
            <span>${trx.cash}</span>
        </div>
        <div class="struk-item">
            <span>Kembali:</span>
            <span>${trx.change}</span>
        </div>
        <div class="struk-footer">
            Terima Kasih Atas<br>Kunjungan Anda
        </div>
    `;
  window.print();
}

// ================= FITUR SINKRONISASI (FETCH API) =================

function updateSyncUI() {
  const history = JSON.parse(localStorage.getItem("pos_history")) || [];
  const pendingSyncCount = history.filter(
    (trx) => trx.isCompleted && !trx.isSynced
  ).length;
  const syncBtn = document.getElementById("btn-sync");
  if (!syncBtn) return;

  if (pendingSyncCount > 0) {
    syncBtn.classList.remove("all-synced");
    syncBtn.innerHTML = `🔄 Sync <span class="badge" id="sync-badge">${pendingSyncCount}</span>`;
  } else {
    syncBtn.classList.add("all-synced");
    syncBtn.innerHTML = `✅ Tersinkron`;
  }

  // ==== TAMBAHKAN BARIS INI DI SINI ====
  updateRevenueUI(); 
}

async function sinkronisasiData(isAuto = false) {
  if (!navigator.onLine) {
    if (!isAuto)
      alert("Tidak ada koneksi internet. Sistem berada dalam mode offline.");
    return;
  }

  let history = JSON.parse(localStorage.getItem("pos_history")) || [];
  let pendingTransactions = history.filter(
    (trx) => trx.isCompleted && !trx.isSynced
  );

  if (pendingTransactions.length === 0) {
    if (!isAuto) alert("Semua transaksi sudah tersinkronisasi ke database!");
    return;
  }

  const syncBtn = document.getElementById("btn-sync");
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = `⏳ ${isAuto ? "Auto-Sync..." : "Mengirim..."}`;
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "syncTransactions",
        id_admin: sessionData.id_admin,
        transactions: pendingTransactions,
      }),
    });

    const result = await response.json();

    if (result.status === "success") {
      // Tandai sudah di-sync
      history = history.map((trx) => {
        if (trx.isCompleted && !trx.isSynced) return { ...trx, isSynced: true };
        return trx;
      });

      localStorage.setItem("pos_history", JSON.stringify(history));
      renderHistory();
      updateSyncUI();

      if (!isAuto) alert("Data berhasil dikirim ke Spreadsheet!");
    } else {
      if (!isAuto) alert("Gagal mengirim data: " + result.message);
    }
  } catch (error) {
    if (!isAuto) alert("Koneksi ke Apps Script gagal.");
  } finally {
    if (syncBtn) syncBtn.disabled = false;
    updateSyncUI();
  }
}

window.addEventListener("online", () => {
  sinkronisasiData(true);
});

// Mengambil Riwayat Transaksi langsung dari Spreadsheet
async function ambilDataRiwayat() {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "getHistory", id_admin: sessionData.id_admin })
        });
        const result = await response.json();

        if (result.status === "success") {
            const serverHistory = result.data;
            
            // Amankan transaksi lokal yang BELUM dikirim (karena internet mati sebelumnya)
            const localHistory = JSON.parse(localStorage.getItem('pos_history')) || [];
            const pendingHistory = localHistory.filter(trx => !trx.isSynced);
            
            // Gabungkan: Transaksi Pending (lokal) + Riwayat Server (dibalik agar yang terbaru di atas)
            const combinedHistory = [...pendingHistory, ...serverHistory.reverse()];
            
            // Timpa local storage dengan data gabungan ini
            localStorage.setItem('pos_history', JSON.stringify(combinedHistory));
            
            // Perbarui UI jika modal riwayat sedang terbuka
            updateSyncUI();
            if (document.getElementById("history-modal").classList.contains("active")) {
                renderHistory();
            }
        }
    } catch (error) {
        console.log("Gagal menarik riwayat transaksi dari server (Mungkin sedang offline).");
    }
}

function updateRevenueUI() {
    const history = JSON.parse(localStorage.getItem("pos_history")) || [];
    
    // Hitung total dari SEMUA transaksi yang sudah Selesai (Dibayar)
    const totalRevenue = history.reduce((sum, trx) => {
        return trx.isCompleted ? sum + trx.total : sum;
    }, 0);
    
    const revenueEl = document.getElementById("total-revenue");
    if (revenueEl) {
        revenueEl.innerText = formatRupiah(totalRevenue);
    }
}

// ================= INISIALISASI APLIKASI =================
window.onload = () => {
  if (sessionData) {
    // Jika sudah pernah login (ada session)
    document.getElementById("login-overlay").classList.remove("active");
    document.getElementById("admin-info").innerText = sessionData.nama_admin;
    ambilDataProduk();
    ambilDataRiwayat();
  } else {
    // Jika belum login, pastikan overlay muncul
    document.getElementById("login-overlay").classList.add("active");
  }
  updateSyncUI();
};
