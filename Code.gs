// ==========================================
// BACKEND POS WEB - GOOGLE APPS SCRIPT
// Keamanan: session token + rate limit login
// ==========================================

var SESSION_SHEET_NAME = "SESSIONS";
var SESSION_TTL_MS = 12 * 60 * 60 * 1000; // Token valid 12 jam
var MAX_LOGIN_ATTEMPTS = 5; // Gagal 5x PIN dikunci
var LOGIN_LOCK_SECONDS = 15 * 60; // Durasi kunci 15 menit
var MAX_SYNC_BATCH = 100; // Maksimal transaksi per sync

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createResponse({ status: "error", message: "Request tidak valid." });
    }

    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action;

    // Login adalah satu-satunya action tanpa token
    if (action === "login") {
      return handleLogin(requestData.pin);
    }

    // Semua action lain WAJIB punya token sesi yang valid
    var session = validateSession(requestData.token);
    if (!session) {
      return createResponse({
        status: "unauthorized",
        message: "Sesi tidak valid atau kedaluwarsa.",
      });
    }

    if (action === "logout") {
      return handleLogout(session);
    } else if (action === "getProducts") {
      return handleGetProducts(session.id_admin);
    } else if (action === "syncTransactions") {
      return handleSyncTransactions(session.id_admin, requestData.transactions);
    } else if (action === "getHistory") {
      return handleGetHistory(session.id_admin);
    } else if (action === "deleteTransaction") {
      return handleDeleteTransaction(session.id_admin, requestData.trx_id);
    } else if (action === "deleteAllHistory") {
      return handleDeleteAllHistory(session.id_admin);
    } else if (action === "saveProduct") {
      return handleSaveProduct(session.id_admin, requestData.product);
    } else if (action === "deleteProduct") {
      return handleDeleteProduct(session.id_admin, requestData.product_id);
    } else if (action === "getAdmins") {
      return handleGetAdmins(session);
    } else if (action === "saveAdmin") {
      return handleSaveAdmin(session, requestData.admin);
    } else if (action === "deleteAdmin") {
      return handleDeleteAdmin(session, requestData.kasir_id);
    } else {
      return createResponse({ status: "error", message: "Action tidak dikenali." });
    }
  } catch (error) {
    return createResponse({ status: "error", message: error.message });
  }
}

function doGet() {
  return createResponse({ status: "ok", message: "KasirKu API aktif" });
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSheetData(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet " + sheetName + " tidak ditemukan.");

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var rowObject = {};
    for (var j = 0; j < headers.length; j++) {
      rowObject[headers[j]] = data[i][j];
    }
    rowObject.rowIndex = i + 1;
    rows.push(rowObject);
  }
  return { sheet: sheet, data: rows };
}

function getColumnIndex(sheet, headerName) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) throw new Error("Header tidak ditemukan.");
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toUpperCase() === headerName.toUpperCase()) {
      return i + 1;
    }
  }
  throw new Error("Kolom " + headerName + " tidak ditemukan.");
}

function ensureColumn(sheet, name) {
  var lastCol = sheet.getLastColumn();
  if (lastCol > 0) {
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim().toUpperCase() === name.toUpperCase()) {
        return i + 1;
      }
    }
  }
  sheet.getRange(1, lastCol + 1).setValue(name);
  return lastCol + 1;
}

function buatIdAcak(prefix) {
  return (
    prefix +
    "-" +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 1000)
  );
}

// ==========================================
// 1. SESSION & TOKEN
// ==========================================
function getSessionSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SESSION_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SESSION_SHEET_NAME);
    sheet.appendRow(["Token", "ID_Admin", "Nama_Admin", "Dibuat", "Kadaluarsa", "Kasir_ID"]);
  } else {
    ensureColumn(sheet, "Kasir_ID");
  }
  return sheet;
}

function createSession(idAdmin, namaAdmin, kasirId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSessionSheet();
    var nowMs = new Date().getTime();
    var expires = new Date(nowMs + SESSION_TTL_MS);

    // Bersihkan sesi yang sudah kedaluwarsa
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (new Date(data[i][4]).getTime() < nowMs) {
        sheet.deleteRow(i + 1);
      }
    }

    var token = Utilities.getUuid();
    sheet.appendRow([token, String(idAdmin), String(namaAdmin), new Date(nowMs), expires, String(kasirId || "")]);
    return token;
  } finally {
    lock.releaseLock();
  }
}

function validateSession(token) {
  if (!token || typeof token !== "string" || token.length > 128) return null;

  var sheet = getSessionSheet();
  var data = sheet.getDataRange().getValues();
  var nowMs = new Date().getTime();

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === token) {
      if (new Date(data[i][4]).getTime() < nowMs) {
        sheet.deleteRow(i + 1);
        return null;
      }
      return {
        token: token,
        id_admin: String(data[i][1]),
        nama_admin: String(data[i][2]),
        kasir_id: String(data[i][5] || ""),
      };
    }
  }
  return null;
}

function deleteSession(token) {
  var sheet = getSessionSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === token) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function handleLogout(session) {
  deleteSession(session.token);
  return createResponse({ status: "success", message: "Logout berhasil." });
}

function pastikanKasirId(sheetAdmin, rowIndex) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var col = ensureColumn(sheetAdmin, "ID_Kasir");
    var val = String(sheetAdmin.getRange(rowIndex, col).getValue() || "").trim();
    if (val === "") {
      val = buatIdAcak("K");
      sheetAdmin.getRange(rowIndex, col).setValue(val);
    }
    return val;
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 2. RATE LIMIT LOGIN (CacheService)
// ==========================================
function isLoginLocked(pin) {
  var attempts = Number(CacheService.getScriptCache().get("login_fail_" + pin) || 0);
  return attempts >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(pin) {
  var cache = CacheService.getScriptCache();
  var key = "login_fail_" + pin;
  var attempts = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(attempts), LOGIN_LOCK_SECONDS);
}

function clearLoginFailure(pin) {
  CacheService.getScriptCache().remove("login_fail_" + pin);
}

// ==========================================
// 3. FUNGSI LOGIN
// ==========================================
function handleLogin(pin) {
  var pinStr = String(pin === null || pin === undefined ? "" : pin).trim();

  if (!/^\d{4,8}$/.test(pinStr)) {
    return createResponse({ status: "error", message: "Format PIN tidak valid." });
  }

  if (isLoginLocked(pinStr)) {
    return createResponse({
      status: "error",
      message: "Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit.",
    });
  }

  var adminSheetData = getSheetData("DATA_ADMIN");
  var adminSheet = adminSheetData.sheet;
  var adminData = adminSheetData.data;

  for (var i = 0; i < adminData.length; i++) {
    if (String(adminData[i].PIN) === pinStr) {
      if (String(adminData[i].Status || "").toLowerCase() !== "aktif") {
        return createResponse({ status: "error", message: "Akun ini sedang dinonaktifkan." });
      }

      var kasirId = pastikanKasirId(adminSheet, adminData[i].rowIndex);
      var token = createSession(adminData[i].ID_Admin, adminData[i].Nama_Admin, kasirId);
      clearLoginFailure(pinStr);

      return createResponse({
        status: "success",
        token: token,
        data: {
          id_admin: String(adminData[i].ID_Admin),
          nama_admin: String(adminData[i].Nama_Admin),
          kasir_id: kasirId,
        },
      });
    }
  }

  recordLoginFailure(pinStr);
  return createResponse({ status: "error", message: "PIN salah atau tidak ditemukan." });
}

// ==========================================
// 4. FUNGSI AMBIL PRODUK
// ==========================================
function handleGetProducts(id_admin) {
  var produkData = getSheetData("DATA_PRODUK").data;
  var produkFiltered = [];

  for (var i = 0; i < produkData.length; i++) {
    if (String(produkData[i].ID_Admin) === String(id_admin)) {
      produkFiltered.push({
        id: String(produkData[i].ID_Produk),
        name: String(produkData[i].Nama_Produk || "Tanpa Nama"),
        category: String(produkData[i].Kategori || "Lainnya"),
        price: Number(produkData[i].Harga) || 0,
        stock: Number(produkData[i].Stok) || 0,
      });
    }
  }

  return createResponse({ status: "success", data: produkFiltered });
}

// ==========================================
// 5. FUNGSI SINKRONISASI TRANSAKSI
// ==========================================
function validateTransactions(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error("Tidak ada transaksi untuk disinkronisasi.");
  }
  if (transactions.length > MAX_SYNC_BATCH) {
    throw new Error("Maksimal " + MAX_SYNC_BATCH + " transaksi per sinkronisasi.");
  }
  for (var i = 0; i < transactions.length; i++) {
    var trx = transactions[i];
    if (!trx || typeof trx !== "object") {
      throw new Error("Struktur transaksi tidak valid.");
    }
    if (!trx.id || !trx.timestamp || !Array.isArray(trx.items) || trx.items.length === 0) {
      throw new Error("Transaksi tidak lengkap (id/waktu/item).");
    }
    if (String(trx.id).length > 40) {
      throw new Error("ID transaksi tidak valid.");
    }
    if (trx.items.length > 200) {
      throw new Error("Item transaksi terlalu banyak.");
    }
  }
}

function handleSyncTransactions(id_admin, transactions) {
  try {
    validateTransactions(transactions);
  } catch (err) {
    return createResponse({ status: "error", message: err.message });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetTransaksi = ss.getSheetByName("DATA_TRANSAKSI");
    var sheetDetail = ss.getSheetByName("DETAIL_TRANSAKSI");

    var sheetProdukData = getSheetData("DATA_PRODUK");
    var sheetProduk = sheetProdukData.sheet;
    var listProduk = sheetProdukData.data;
    var stokCol = getColumnIndex(sheetProduk, "Stok");

    // Kumpulkan ID transaksi yang sudah ada (cegah duplikat saat retry)
    var existingIds = {};
    var dataTrxExisting = sheetTransaksi.getDataRange().getValues();
    for (var d = 1; d < dataTrxExisting.length; d++) {
      existingIds[String(dataTrxExisting[d][0])] = true;
    }

    var savedCount = 0;

    for (var i = 0; i < transactions.length; i++) {
      var trx = transactions[i];
      var trxId = String(trx.id);

      if (existingIds[trxId]) continue;

      sheetTransaksi.appendRow([
        trxId,
        String(trx.timestamp),
        String(id_admin),
        String(trx.buyerName || "Pelanggan").slice(0, 100),
        Number(trx.totalItem) || 0,
        Number(trx.total) || 0,
        Number(trx.cash) || 0,
        Number(trx.change) || 0,
      ]);
      existingIds[trxId] = true;
      savedCount++;

      for (var j = 0; j < trx.items.length; j++) {
        var item = trx.items[j];
        var qty = Number(item.qty) || 0;
        var price = Number(item.price) || 0;
        if (qty <= 0) continue;

        sheetDetail.appendRow([
          trxId,
          String(item.id),
          String(item.name || ""),
          qty,
          price,
          qty * price,
        ]);

        for (var k = 0; k < listProduk.length; k++) {
          if (
            String(listProduk[k].ID_Produk) === String(item.id) &&
            String(listProduk[k].ID_Admin) === String(id_admin)
          ) {
            var stokBaru = Number(listProduk[k].Stok) - qty;
            listProduk[k].Stok = stokBaru;
            sheetProduk.getRange(listProduk[k].rowIndex, stokCol).setValue(stokBaru);
            break;
          }
        }
      }
    }

    return createResponse({
      status: "success",
      message: savedCount + " transaksi berhasil disinkronisasi.",
    });
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 6. FUNGSI AMBIL RIWAYAT TRANSAKSI
// ==========================================
function handleGetHistory(id_admin) {
  var sheetTransaksiData = getSheetData("DATA_TRANSAKSI").data;
  var sheetDetailData = getSheetData("DETAIL_TRANSAKSI").data;

  var history = [];

  for (var i = 0; i < sheetTransaksiData.length; i++) {
    if (String(sheetTransaksiData[i].ID_Admin) === String(id_admin)) {
      var trxId = String(sheetTransaksiData[i].ID_Transaksi);

      var items = [];
      for (var j = 0; j < sheetDetailData.length; j++) {
        if (String(sheetDetailData[j].ID_Transaksi) === trxId) {
          items.push({
            id: String(sheetDetailData[j].ID_Produk),
            name: String(sheetDetailData[j].Nama_Produk),
            qty: Number(sheetDetailData[j].Qty) || 0,
            price: Number(sheetDetailData[j].Harga_Satuan) || 0,
          });
        }
      }

      history.push({
        id: trxId,
        timestamp: sheetTransaksiData[i].Waktu,
        buyerName: String(sheetTransaksiData[i].Pelanggan || "Pelanggan"),
        items: items,
        totalItem: Number(sheetTransaksiData[i].Total_Item) || 0,
        total: Number(sheetTransaksiData[i].Total_Bayar) || 0,
        cash: Number(sheetTransaksiData[i].Uang_Tunai) || 0,
        change: Number(sheetTransaksiData[i].Kembalian) || 0,
        isCompleted: true,
        isSynced: true,
      });
    }
  }

  return createResponse({ status: "success", data: history });
}

// ==========================================
// 7. FUNGSI HAPUS TRANSAKSI DI SPREADSHEET
//    (stok produk dikembalikan saat dihapus)
// ==========================================
function kembalikanStokDariDetail(ss, trxId, id_admin) {
  var detailResult = getSheetData("DETAIL_TRANSAKSI");
  var detailData = detailResult.data;
  var sheetDetail = detailResult.sheet;

  var sheetProdukData = getSheetData("DATA_PRODUK");
  var sheetProduk = sheetProdukData.sheet;
  var listProduk = sheetProdukData.data;
  var stokCol = getColumnIndex(sheetProduk, "Stok");

  var rowsToDelete = [];
  var restoredCount = 0;

  for (var j = detailData.length - 1; j >= 0; j--) {
    if (String(detailData[j].ID_Transaksi) !== trxId) continue;

    var itemId = String(detailData[j].ID_Produk);
    var qty = Number(detailData[j].Qty) || 0;

    if (qty > 0) {
      for (var k = 0; k < listProduk.length; k++) {
        if (
          String(listProduk[k].ID_Produk) === itemId &&
          String(listProduk[k].ID_Admin) === String(id_admin)
        ) {
          var stokBaru = Number(listProduk[k].Stok) + qty;
          listProduk[k].Stok = stokBaru;
          sheetProduk.getRange(listProduk[k].rowIndex, stokCol).setValue(stokBaru);
          restoredCount++;
          break;
        }
      }
    }
    rowsToDelete.push(detailData[j].rowIndex);
  }

  rowsToDelete.sort(function (a, b) {
    return b - a;
  });
  for (var r = 0; r < rowsToDelete.length; r++) {
    sheetDetail.deleteRow(rowsToDelete[r]);
  }

  return restoredCount;
}

function handleDeleteTransaction(id_admin, trx_id) {
  var trxId = String(trx_id === null || trx_id === undefined ? "" : trx_id).trim();
  if (!trxId || trxId.length > 40) {
    return createResponse({ status: "error", message: "ID transaksi tidak valid." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetTrx = ss.getSheetByName("DATA_TRANSAKSI");

    var dataTrx = sheetTrx.getDataRange().getValues();
    var found = false;
    for (var i = dataTrx.length - 1; i > 0; i--) {
      if (String(dataTrx[i][0]) === trxId && String(dataTrx[i][2]) === String(id_admin)) {
        sheetTrx.deleteRow(i + 1);
        found = true;
        break;
      }
    }

    if (!found) {
      return createResponse({ status: "error", message: "Transaksi tidak ditemukan." });
    }

    var restoredCount = kembalikanStokDariDetail(ss, trxId, id_admin);

    return createResponse({
      status: "success",
      message:
        restoredCount > 0
          ? "Transaksi dihapus dan stok " + restoredCount + " item dikembalikan."
          : "Transaksi dihapus.",
    });
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 8. FUNGSI HAPUS SEMUA RIWAYAT TOKO INI
// Catatan: stok sengaja TIDAK dikembalikan.
// Aksi ini untuk membersihkan catatan, bukan
// membatalkan penjualan.
// ==========================================
function handleDeleteAllHistory(id_admin) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetTrx = ss.getSheetByName("DATA_TRANSAKSI");
  var sheetDetail = ss.getSheetByName("DETAIL_TRANSAKSI");

  var dataTrx = sheetTrx.getDataRange().getValues();
  var trxIdsToDelete = [];

  for (var i = dataTrx.length - 1; i > 0; i--) {
    if (String(dataTrx[i][2]) === String(id_admin)) {
      trxIdsToDelete.push(String(dataTrx[i][0]));
      sheetTrx.deleteRow(i + 1);
    }
  }

  var dataDetail = sheetDetail.getDataRange().getValues();
  for (var j = dataDetail.length - 1; j > 0; j--) {
    if (trxIdsToDelete.indexOf(String(dataDetail[j][0])) !== -1) {
      sheetDetail.deleteRow(j + 1);
    }
  }

  return createResponse({ status: "success", message: "Semua riwayat toko berhasil dihapus." });
}

// ==========================================
// 9. FUNGSI KELOLA PRODUK
// ==========================================
function handleSaveProduct(id_admin, product) {
  if (!product || typeof product !== "object") {
    return createResponse({ status: "error", message: "Data produk tidak valid." });
  }

  var name = String(product.name || "").trim();
  var category = String(product.category || "").trim() || "Lainnya";
  var price = Number(product.price);
  var stock = Number(product.stock);

  if (name === "" || name.length > 100) {
    return createResponse({ status: "error", message: "Nama produk wajib diisi (maksimal 100 karakter)." });
  }
  if (category.length > 50) {
    return createResponse({ status: "error", message: "Kategori maksimal 50 karakter." });
  }
  if (isNaN(price) || price < 0) {
    return createResponse({ status: "error", message: "Harga tidak valid." });
  }
  if (isNaN(stock) || stock < 0 || Math.floor(stock) !== stock) {
    return createResponse({ status: "error", message: "Stok harus bilangan bulat 0 atau lebih." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var produkResult = getSheetData("DATA_PRODUK");
    var sheet = produkResult.sheet;
    var rows = produkResult.data;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    var colNama = getColumnIndex(sheet, "Nama_Produk");
    var colKategori = getColumnIndex(sheet, "Kategori");
    var colHarga = getColumnIndex(sheet, "Harga");
    var colStok = getColumnIndex(sheet, "Stok");

    if (product.id) {
      for (var i = 0; i < rows.length; i++) {
        if (
          String(rows[i].ID_Produk) === String(product.id) &&
          String(rows[i].ID_Admin) === String(id_admin)
        ) {
          sheet.getRange(rows[i].rowIndex, colNama).setValue(name);
          sheet.getRange(rows[i].rowIndex, colKategori).setValue(category);
          sheet.getRange(rows[i].rowIndex, colHarga).setValue(price);
          sheet.getRange(rows[i].rowIndex, colStok).setValue(stock);
          return createResponse({ status: "success", message: "Produk berhasil diperbarui." });
        }
      }
      return createResponse({ status: "error", message: "Produk tidak ditemukan." });
    }

    var newId = buatIdAcak("P");
    var values = {
      ID_Produk: newId,
      ID_Admin: String(id_admin),
      Nama_Produk: name,
      Kategori: category,
      Harga: price,
      Stok: stock,
    };
    var newRow = [];
    for (var h = 0; h < headers.length; h++) {
      var key = String(headers[h]);
      newRow.push(values.hasOwnProperty(key) ? values[key] : "");
    }
    sheet.appendRow(newRow);
    return createResponse({ status: "success", message: "Produk berhasil ditambahkan.", id: newId });
  } finally {
    lock.releaseLock();
  }
}

function handleDeleteProduct(id_admin, product_id) {
  var productId = String(product_id === null || product_id === undefined ? "" : product_id).trim();
  if (!productId || productId.length > 40) {
    return createResponse({ status: "error", message: "ID produk tidak valid." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var produkResult = getSheetData("DATA_PRODUK");
    var rows = produkResult.data;
    var sheet = produkResult.sheet;

    for (var i = rows.length - 1; i >= 0; i--) {
      if (
        String(rows[i].ID_Produk) === productId &&
        String(rows[i].ID_Admin) === String(id_admin)
      ) {
        sheet.deleteRow(rows[i].rowIndex);
        return createResponse({ status: "success", message: "Produk berhasil dihapus." });
      }
    }
    return createResponse({ status: "error", message: "Produk tidak ditemukan." });
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 10. FUNGSI KELOLA KASIR (multi-PIN satu toko)
// ==========================================
function handleGetAdmins(session) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DATA_ADMIN");
    if (!sheet) return createResponse({ status: "error", message: "Sheet DATA_ADMIN tidak ditemukan." });
    var colId = ensureColumn(sheet, "ID_Kasir");

    var rows = getSheetData("DATA_ADMIN").data;
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].ID_Admin) !== String(session.id_admin)) continue;
      var kasirId = String(rows[i].ID_Kasir || "").trim();
      if (kasirId === "") {
        kasirId = buatIdAcak("K");
        sheet.getRange(rows[i].rowIndex, colId).setValue(kasirId);
      }
      list.push({
        kasir_id: kasirId,
        nama_admin: String(rows[i].Nama_Admin || ""),
        status: String(rows[i].Status || "").toLowerCase() === "aktif" ? "aktif" : "nonaktif",
        is_self: kasirId !== "" && kasirId === String(session.kasir_id || ""),
      });
    }
    return createResponse({ status: "success", data: list });
  } finally {
    lock.releaseLock();
  }
}

function handleSaveAdmin(session, admin) {
  if (!admin || typeof admin !== "object") {
    return createResponse({ status: "error", message: "Data kasir tidak valid." });
  }

  var nama = String(admin.nama_admin || "").trim();
  var status = String(admin.status || "").toLowerCase() === "nonaktif" ? "nonaktif" : "aktif";
  var pin = String(admin.pin === null || admin.pin === undefined ? "" : admin.pin).trim();

  if (nama === "" || nama.length > 50) {
    return createResponse({ status: "error", message: "Nama kasir wajib diisi (maksimal 50 karakter)." });
  }
  if (pin !== "" && !/^\d{4,8}$/.test(pin)) {
    return createResponse({ status: "error", message: "PIN harus 4-8 digit angka." });
  }
  if (admin.kasir_id && String(admin.kasir_id) === String(session.kasir_id || "") && status !== "aktif") {
    return createResponse({ status: "error", message: "Anda tidak bisa menonaktifkan akun sendiri." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DATA_ADMIN");
    if (!sheet) return createResponse({ status: "error", message: "Sheet DATA_ADMIN tidak ditemukan." });
    ensureColumn(sheet, "ID_Kasir");

    var rows = getSheetData("DATA_ADMIN").data;
    var colNama = getColumnIndex(sheet, "Nama_Admin");
    var colStatus = getColumnIndex(sheet, "Status");
    var colPin = getColumnIndex(sheet, "PIN");

    var storeRows = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].ID_Admin) === String(session.id_admin)) storeRows.push(rows[i]);
    }

    if (admin.kasir_id) {
      var target = null;
      for (var j = 0; j < storeRows.length; j++) {
        if (String(storeRows[j].ID_Kasir || "") === String(admin.kasir_id)) {
          target = storeRows[j];
          break;
        }
      }
      if (!target) return createResponse({ status: "error", message: "Kasir tidak ditemukan." });

      if (status !== "aktif") {
        var aktifLain = 0;
        for (var a = 0; a < storeRows.length; a++) {
          if (String(storeRows[a].ID_Kasir || "") !== String(admin.kasir_id) && String(storeRows[a].Status || "").toLowerCase() === "aktif") {
            aktifLain++;
          }
        }
        if (aktifLain === 0) {
          return createResponse({ status: "error", message: "Tidak bisa menonaktifkan kasir aktif terakhir." });
        }
      }

      sheet.getRange(target.rowIndex, colNama).setValue(nama);
      sheet.getRange(target.rowIndex, colStatus).setValue(status);
      if (pin !== "") sheet.getRange(target.rowIndex, colPin).setValue(pin);
      return createResponse({ status: "success", message: "Data kasir diperbarui." });
    }

    if (pin === "") {
      return createResponse({ status: "error", message: "PIN wajib diisi untuk kasir baru." });
    }
    for (var b = 0; b < rows.length; b++) {
      if (String(rows[b].PIN) === pin) {
        return createResponse({ status: "error", message: "PIN sudah dipakai. Gunakan PIN lain." });
      }
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var values = {
      ID_Admin: String(session.id_admin),
      Nama_Admin: nama,
      PIN: pin,
      Status: "aktif",
      ID_Kasir: buatIdAcak("K"),
    };
    var newRow = [];
    for (var h = 0; h < headers.length; h++) {
      var key = String(headers[h]);
      newRow.push(values.hasOwnProperty(key) ? values[key] : "");
    }
    sheet.appendRow(newRow);
    return createResponse({ status: "success", message: "Kasir baru berhasil ditambahkan." });
  } finally {
    lock.releaseLock();
  }
}

function handleDeleteAdmin(session, kasir_id) {
  var kasirId = String(kasir_id === null || kasir_id === undefined ? "" : kasir_id).trim();
  if (!kasirId || kasirId.length > 40) {
    return createResponse({ status: "error", message: "ID kasir tidak valid." });
  }
  if (kasirId === String(session.kasir_id || "")) {
    return createResponse({ status: "error", message: "Anda tidak bisa menghapus akun sendiri." });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DATA_ADMIN");
    if (!sheet) return createResponse({ status: "error", message: "Sheet DATA_ADMIN tidak ditemukan." });
    ensureColumn(sheet, "ID_Kasir");

    var rows = getSheetData("DATA_ADMIN").data;
    var target = null;
    var aktifLain = 0;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].ID_Admin) !== String(session.id_admin)) continue;
      if (String(rows[i].ID_Kasir || "") === kasirId) {
        target = rows[i];
      } else if (String(rows[i].Status || "").toLowerCase() === "aktif") {
        aktifLain++;
      }
    }

    if (!target) return createResponse({ status: "error", message: "Kasir tidak ditemukan." });
    if (String(target.Status || "").toLowerCase() === "aktif" && aktifLain === 0) {
      return createResponse({ status: "error", message: "Tidak bisa menghapus kasir aktif terakhir." });
    }

    sheet.deleteRow(target.rowIndex);
    return createResponse({ status: "success", message: "Kasir berhasil dihapus." });
  } finally {
    lock.releaseLock();
  }
}
