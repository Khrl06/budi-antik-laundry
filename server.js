const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi Database: Prioritaskan Neon Postgres (Vercel) jika ada env DATABASE_URL / POSTGRES_URL
const postgresUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
let neonSql = null;

if (postgresUrl) {
  try {
    const { neon } = require('@neondatabase/serverless');
    neonSql = neon(postgresUrl);
    console.log('Neon PostgreSQL berhasil terhubung!');
  } catch (err) {
    console.error('Gagal menghubungkan Neon PostgreSQL:', err.message);
  }
}

// Fallback SQLite lokal jika bukan di serverless
let sqliteDb = null;
let memoryOrders = [];
const dataDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
}
const jsonDbPath = path.join(dataDir, 'orders.json');

if (!neonSql) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    sqliteDb = new DatabaseSync(path.join(dataDir, 'laundry.db'));
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT UNIQUE,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        service_type TEXT NOT NULL,
        estimated_weight TEXT,
        pickup_address TEXT NOT NULL,
        pickup_notes TEXT,
        pickup_date TEXT NOT NULL,
        pickup_time TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        fonnte_status TEXT DEFAULT 'sent',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err) {
    if (fs.existsSync(jsonDbPath)) {
      try { memoryOrders = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8')); } catch (e) { memoryOrders = []; }
    }
  }
}

// Inisialisasi tabel di Neon jika belum ada
let tableChecked = false;
async function ensureNeonTable() {
  if (!neonSql || tableChecked) return;
  try {
    await neonSql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_code VARCHAR(50) UNIQUE,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        service_type VARCHAR(100) NOT NULL,
        estimated_weight VARCHAR(100),
        pickup_address TEXT NOT NULL,
        pickup_notes TEXT,
        pickup_date VARCHAR(50) NOT NULL,
        pickup_time VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        fonnte_status VARCHAR(50) DEFAULT 'sent',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    tableChecked = true;
  } catch (err) {
    console.error('Error saat membuat tabel Neon:', err.message);
  }
}

// Helper DB (Mendukung Neon Async & SQLite)
async function insertOrder(orderData) {
  if (neonSql) {
    await ensureNeonTable();
    await neonSql`
      INSERT INTO orders (
        order_code, customer_name, customer_phone, service_type,
        estimated_weight, pickup_address, pickup_notes, pickup_date, pickup_time,
        status, fonnte_status
      ) VALUES (
        ${orderData.order_code}, ${orderData.customer_name}, ${orderData.customer_phone},
        ${orderData.service_type}, ${orderData.estimated_weight}, ${orderData.pickup_address},
        ${orderData.pickup_notes}, ${orderData.pickup_date}, ${orderData.pickup_time},
        'pending', 'sent'
      )
    `;
  } else if (sqliteDb) {
    const insertStmt = sqliteDb.prepare(`
      INSERT INTO orders (
        order_code, customer_name, customer_phone, service_type,
        estimated_weight, pickup_address, pickup_notes, pickup_date, pickup_time,
        status, fonnte_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'sent')
    `);
    insertStmt.run(
      orderData.order_code,
      orderData.customer_name,
      orderData.customer_phone,
      orderData.service_type,
      orderData.estimated_weight,
      orderData.pickup_address,
      orderData.pickup_notes,
      orderData.pickup_date,
      orderData.pickup_time
    );
  } else {
    const newOrder = {
      id: memoryOrders.length + 1,
      ...orderData,
      status: 'pending',
      fonnte_status: 'sent',
      created_at: new Date().toISOString()
    };
    memoryOrders.unshift(newOrder);
    try { fs.writeFileSync(jsonDbPath, JSON.stringify(memoryOrders, null, 2)); } catch (e) {}
  }
}

async function getAllOrders() {
  if (neonSql) {
    await ensureNeonTable();
    const rows = await neonSql`SELECT * FROM orders ORDER BY id DESC`;
    return rows;
  } else if (sqliteDb) {
    return sqliteDb.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  }
  return memoryOrders;
}

async function updateOrderStatus(id, status) {
  if (neonSql) {
    await ensureNeonTable();
    const rows = await neonSql`SELECT * FROM orders WHERE id = ${id}`;
    if (!rows || rows.length === 0) return null;
    await neonSql`UPDATE orders SET status = ${status} WHERE id = ${id}`;
    return rows[0];
  } else if (sqliteDb) {
    const order = sqliteDb.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return null;
    sqliteDb.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
    return order;
  } else {
    const order = memoryOrders.find(o => o.id === Number(id));
    if (!order) return null;
    order.status = status;
    try { fs.writeFileSync(jsonDbPath, JSON.stringify(memoryOrders, null, 2)); } catch (e) {}
    return order;
  }
}

// Normalisasi nomor telepon
function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '628' + cleaned.substring(1);
  }
  return cleaned;
}

// Kirim pesan WhatsApp via Fonnte API
async function sendFonnteWA(target, message) {
  const token = process.env.FONNTE_TOKEN;
  const normalizedTarget = normalizePhone(target);

  if (!token || token.trim() === '' || token.includes('ganti_')) {
    console.log(`[FONNTE SIMULASI] Pesan ke ${normalizedTarget}:\n${message}`);
    return {
      status: true,
      simulation: true,
      message: 'Simulasi WA sukses (token belum diisi di env)'
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('target', normalizedTarget);
    formData.append('message', message);
    formData.append('countryCode', '62');

    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': token.trim(),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`[FONNTE ERROR ${normalizedTarget}]:`, err.message);
    return { status: false, error: err.message };
  }
}

function generateOrderCode() {
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `BAL-${dateStr}-${randomSuffix}`;
}

// API Endpoints
app.get('/api/config', (req, res) => {
  res.json({
    businessName: process.env.BUSINESS_NAME || 'Budi Antik Laundry',
    businessTagline: process.env.BUSINESS_TAGLINE || 'Solusi Cuci Bersih, Wangi & Cepat di Majasem Kota Cirebon',
    businessAddress: process.env.BUSINESS_ADDRESS || 'Jl. Majasem Raya, Kel. Karyamulya, Kec. Kesambi, Kota Cirebon',
    businessPhone: process.env.BUSINESS_PHONE || '085962738788',
    fonnteConfigured: Boolean(process.env.FONNTE_TOKEN && !process.env.FONNTE_TOKEN.includes('ganti_')),
    databaseType: neonSql ? 'Neon PostgreSQL (Permanent Cloud)' : 'Local File Adapter'
  });
});

app.post('/api/orders', async (req, res) => {
  try {
    const {
      customer_name,
      customer_phone,
      service_type,
      estimated_weight,
      pickup_address,
      pickup_notes,
      pickup_date,
      pickup_time
    } = req.body;

    if (!customer_name || !customer_phone || !pickup_address || !pickup_date || !pickup_time) {
      return res.status(400).json({
        success: false,
        message: 'Mohon lengkapi semua kolom wajib (Nama, WhatsApp, Alamat, Tanggal, dan Jam Jemput).'
      });
    }

    const orderCode = generateOrderCode();
    const cleanPhone = customer_phone.trim();

    await insertOrder({
      order_code: orderCode,
      customer_name: customer_name.trim(),
      customer_phone: cleanPhone,
      service_type: service_type || 'Cuci Komplit Kiloan (Reguler)',
      estimated_weight: estimated_weight || 'Belum ditimbang (jemput dulu)',
      pickup_address: pickup_address.trim(),
      pickup_notes: pickup_notes ? pickup_notes.trim() : '-',
      pickup_date,
      pickup_time
    });

    const customerMsg =
`🧺 *PESANAN DITERIMA - BUDI ANTIK LAUNDRY* 🧺

Halo Kak *${customer_name.trim()}*, terima kasih telah memesan layanan laundry di *Budi Antik Laundry (Majasem, Cirebon)*!

Detail Pesanan Anda:
━━━━━━━━━━━━━━━━━━━
🔖 *No. Order:* \`${orderCode}\`
👕 *Layanan:* ${service_type || 'Cuci Komplit'}
⚖️ *Estimasi:* ${estimated_weight || 'Timbang saat jemput'}
📅 *Jadwal Jemput:* ${pickup_date} (Pukul ${pickup_time})
📍 *Alamat Jemput:* ${pickup_address.trim()}
📝 *Catatan:* ${pickup_notes ? pickup_notes.trim() : '-'}
━━━━━━━━━━━━━━━━━━━

Kurir kami akan segera meluncur untuk mengambil cucian Anda sesuai jadwal. Mohon pastikan pakaian sudah siap dan nomor ini aktif.

Ada pertanyaan? Hubungi kami langsung di WA ini.
_Budi Antik Laundry: Bersih, Rapi, Harum & 1 Mesin 1 Pelanggan._`;

    const adminPhone = process.env.ADMIN_WHATSAPP || '085962738788';
    const adminMsg =
`🚨 *ORDER JEMPUT LAUNDRY BARU MASUK!* 🚨

Terdapat pesanan baru dari website:
━━━━━━━━━━━━━━━━━━━
🔖 *No. Order:* \`${orderCode}\`
👤 *Pelanggan:* ${customer_name.trim()}
📱 *WhatsApp:* https://wa.me/${normalizePhone(cleanPhone)}
👕 *Layanan:* ${service_type}
⚖️ *Estimasi:* ${estimated_weight || '-'}
📅 *Jemput:* ${pickup_date} jam ${pickup_time}
📍 *Alamat Jemput:* ${pickup_address.trim()}
📝 *Catatan:* ${pickup_notes ? pickup_notes.trim() : '-'}
━━━━━━━━━━━━━━━━━━━
Segera atur penjemputan oleh kurir!`;

    const fonnteResultCust = await sendFonnteWA(cleanPhone, customerMsg);
    let fonnteResultAdmin = null;
    if (adminPhone && adminPhone.trim() !== '') {
      fonnteResultAdmin = await sendFonnteWA(adminPhone, adminMsg);
    }

    res.status(201).json({
      success: true,
      orderCode,
      message: 'Pesanan Anda berhasil dikirim! Notifikasi WhatsApp otomatis telah dikirimkan.',
      fonnteResult: {
        customer: fonnteResultCust,
        admin: fonnteResultAdmin
      }
    });

  } catch (err) {
    console.error('Error saat membuat order:', err);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan sistem saat memproses order: ' + err.message
    });
  }
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'budiantik123';

function checkAdminAuth(req, res, next) {
  const token = req.headers['x-admin-key'] || req.query.key;
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Akses ditolak: Password admin salah atau belum dimasukkan' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: ADMIN_PASSWORD });
  }
  res.status(401).json({ success: false, message: 'Password salah!' });
});

app.get('/api/orders', checkAdminAuth, async (req, res) => {
  try {
    const orders = await getAllOrders();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/orders/:id/status', checkAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notifyCustomer } = req.body;

    const order = await updateOrderStatus(id, status);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
    }

    let waResult = null;
    if (notifyCustomer) {
      let statusDesc = '';
      if (status === 'dijemput') statusDesc = 'Pakaian Anda sudah berhasil DIJEMPUT oleh kurir dan tiba di outlet Budi Antik Laundry.';
      else if (status === 'proses_cuci') statusDesc = 'Pakaian Anda sedang dalam PROSES CUCI & SETRIKA (Higienis, 1 Mesin 1 Pelanggan).';
      else if (status === 'selesai') statusDesc = 'Pakaian Anda sudah SELESAI dicuci bersih, wangi, dan rapi! Siap untuk pengantaran.';
      else if (status === 'diantar') statusDesc = 'Kurir sedang DALAM PERJALANAN MENGANTAR pakaian Anda kembali ke alamat Anda.';
      else statusDesc = `Status pesanan Anda telah diperbarui menjadi: ${status}.`;

      const msg =
`📢 *UPDATE STATUS LAUNDRY - BUDI ANTIK LAUNDRY* 📢

Halo Kak *${order.customer_name}*, berikut kabar status cucian Anda:

🔖 *No. Order:* \`${order.order_code}\`
📍 *Status Sekarang:* *${status.toUpperCase().replace('_', ' ')}*
ℹ️ *Keterangan:* ${statusDesc}

Terima kasih atas kepercayaannya pada Budi Antik Laundry Majasem, Cirebon!`;

      waResult = await sendFonnteWA(order.customer_phone, msg);
    }

    res.json({
      success: true,
      message: `Status pesanan #${order.order_code} berhasil diubah ke ${status}`,
      waResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/test-fonnte', checkAdminAuth, async (req, res) => {
  const { target, message } = req.body;
  if (!target || !message) {
    return res.status(400).json({ success: false, message: 'Target dan message wajib diisi.' });
  }
  const result = await sendFonnteWA(target, message);
  res.json({ success: true, result });
});

// Jalankan Server jika bukan serverless
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`✨ Budi Antik Laundry Web Server Berjalan di Port ${PORT}`);
    console.log(`🌐 Akses Lokal: http://localhost:${PORT}`);
    console.log(`📱 Admin Panel: http://localhost:${PORT}/admin.html`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
