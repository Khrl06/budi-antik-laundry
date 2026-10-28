const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Buat direktori data jika belum ada
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Inisialisasi Database SQLite
const db = new DatabaseSync(path.join(dataDir, 'laundry.db'));
db.exec(`
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
    fonnte_status TEXT DEFAULT 'unprocessed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Helper normalisasi nomor telepon ke format Indonesia (628xxx)
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

// Helper kirim pesan WhatsApp via Fonnte API
async function sendFonnteWA(target, message) {
  const token = process.env.FONNTE_TOKEN;
  const normalizedTarget = normalizePhone(target);

  if (!token || token.trim() === '' || token === 'ganti_dengan_token_fonnte_anda') {
    console.log(`[FONNTE SIMULASI] Token belum diisi di .env. Pesan ke ${normalizedTarget}:\n${message}`);
    return {
      status: true,
      simulation: true,
      message: 'Simulasi kirim WA sukses (token Fonnte belum dikonfigurasi di .env)'
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
    console.log(`[FONNTE RESPONS ${normalizedTarget}]:`, data);
    return data;
  } catch (err) {
    console.error(`[FONNTE ERROR ${normalizedTarget}]:`, err.message);
    return { status: false, error: err.message };
  }
}

// Generate Kode Order (Contoh: BAL-261028-001)
function generateOrderCode() {
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `BAL-${dateStr}-${randomSuffix}`;
}

// API: Konfigurasi Publik
app.get('/api/config', (req, res) => {
  res.json({
    businessName: process.env.BUSINESS_NAME || 'Budi Antik Laundry',
    businessTagline: process.env.BUSINESS_TAGLINE || 'Solusi Cuci Bersih, Wangi & Cepat di Majasem Kota Cirebon',
    businessAddress: process.env.BUSINESS_ADDRESS || 'Jl. Majasem Raya, Kel. Karyamulya, Kec. Kesambi, Kota Cirebon',
    businessPhone: process.env.BUSINESS_PHONE || '081234567890',
    fonnteConfigured: Boolean(process.env.FONNTE_TOKEN && process.env.FONNTE_TOKEN !== 'ganti_dengan_token_fonnte_anda')
  });
});

// API: Buat Order Baru
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

    // Simpan ke database
    const insertStmt = db.prepare(`
      INSERT INTO orders (
        order_code, customer_name, customer_phone, service_type,
        estimated_weight, pickup_address, pickup_notes, pickup_date, pickup_time,
        status, fonnte_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'sent')
    `);

    insertStmt.run(
      orderCode,
      customer_name.trim(),
      cleanPhone,
      service_type || 'Cuci Komplit Kiloan (Reguler)',
      estimated_weight || 'Belum ditimbang (jemput dulu)',
      pickup_address.trim(),
      pickup_notes ? pickup_notes.trim() : '-',
      pickup_date,
      pickup_time
    );

    // Siapkan template pesan untuk Pelanggan
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

    // Siapkan template pesan untuk Admin / Pemilik
    const adminPhone = process.env.ADMIN_WHATSAPP;
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

    // Eksekusi pengiriman WA via Fonnte secara asynchronous
    let fonnteResultCust = await sendFonnteWA(cleanPhone, customerMsg);
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

// API: Ambil Semua Orders (untuk Admin)
app.get('/api/orders', (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Update Status Pesanan & Kirim Update WhatsApp ke Pelanggan
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notifyCustomer } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);

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

// API: Test Kirim Pesan Fonnte
app.post('/api/test-fonnte', async (req, res) => {
  const { target, message } = req.body;
  if (!target || !message) {
    return res.status(400).json({ success: false, message: 'Target dan message wajib diisi.' });
  }
  const result = await sendFonnteWA(target, message);
  res.json({ success: true, result });
});

// Jalankan Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`✨ Budi Antik Laundry Web Server Berjalan di Port ${PORT}`);
  console.log(`🌐 Akses Lokal: http://localhost:${PORT}`);
  console.log(`📱 Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`=======================================================`);
});
