# Budi Antik Laundry - Web & WhatsApp Automation (Majasem, Kota Cirebon)

Website resmi Budi Antik Laundry dengan fitur pemesanan online antar-jemput dan integrasi notifikasi WhatsApp otomatis via Fonnte.com.

## Fitur Utama
1. **Landing Page Modern (Inspirasi LaundryKlin.com):**
   - Desain profesional, bersih, higienis, mobile-friendly (Tailwind CSS).
   - Pilar keunggulan: 1 Mesin 1 Pelanggan, Parfum Mewah Awet, Antar-Jemput Cirebon.
   - Daftar harga lengkap (Kiloan Reguler Rp 7rb/kg, Express 4 Jam Rp 12rb/kg, Bed Cover, Satuan).
   - 4 Langkah Mudah Pemesanan.
   - Peta & Area Jangkauan: Majasem, Karyamulya, Kesambi, Harjamukti, Kota Cirebon.

2. **Form Pemesanan Antar-Jemput Online:**
   - Input Nama, No. WhatsApp, Alamat Jemput di Majasem, Jenis Layanan, Waktu Jemput, & Catatan Khusus.
   - Pembuatan Kode Order Otomatis (contoh: `BAL-261028-481`).
   - Simpan data otomatis ke database SQLite.

3. **Integrasi WhatsApp via Fonnte.com:**
   - **Pesan Otomatis ke Pelanggan:** Rincian order, nomor nota, jadwal jemput, dan konfirmasi kurir.
   - **Pesan Otomatis ke Admin/Pemilik:** Alert notifikasi ada order baru masuk untuk kurir jemput.
   - **Pesan Update Status:** Dikirim saat admin mengubah status di panel (Dijemput -> Proses Cuci -> Selesai -> Diantar).

4. **Admin Panel (`/admin.html`):**
   - Pantau semua order masuk secara live.
   - Ubah status pesanan dan otomatis kirim update ke WA pelanggan.
   - Uji coba kirim pesan Fonnte langsung dari dashboard.

## Cara Konfigurasi Fonnte WhatsApp
Edit file `.env` di folder `/root/budi-antik-laundry/.env`:

```env
PORT=3000
FONNTE_TOKEN=isi_token_fonnte_anda_disini
ADMIN_WHATSAPP=08xxxxxxxxxx
BUSINESS_NAME=Budi Antik Laundry
BUSINESS_TAGLINE=Solusi Cuci Bersih, Wangi & Cepat di Majasem Kota Cirebon
BUSINESS_ADDRESS=Jl. Majasem Raya, Kel. Karyamulya, Kec. Kesambi, Kota Cirebon
BUSINESS_PHONE=08xxxxxxxxxx
```

*Jika token belum diisi, sistem otomatis berjalan dalam Mode Simulasi (pesan tercatat di log server tanpa error).*

## Menjalankan Server
```bash
cd /root/budi-antik-laundry
node server.js
```
Akses di browser:
- Website Pelanggan: `http://localhost:3000` (atau `http://192.168.0.115:3000` dari HP lain di Wi-Fi)
- Admin Panel: `http://localhost:3000/admin.html`
