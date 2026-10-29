# Paket pelengkap GitHub SI-BANYU — 16 file

ZIP ini melengkapi repository `kdkmpbanyurojo/si-banyu` yang pada pemeriksaan 29 Oktober 2026 baru memiliki `idle-session.js` dan `idle-session.test.mjs`. Dua file tersebut sudah memuat perbaikan login.

Ekstrak ZIP ini lalu unggah seluruh 16 file ke akar repository yang sama. Setelah commit, jumlah file di akar menjadi 18. Paket pelengkap ini menggunakan dua file sesi yang sudah ada; untuk membuat repository lain dari awal, gunakan paket lengkap `SI-BANYU-VERCEL.zip`.

Pastikan proyek Vercel terhubung ke repository `kdkmpbanyurojo/si-banyu`, branch `main`, melalui Settings > Git. Tunggu deployment dari commit terbaru berstatus Ready. Redeploy dari sumber lama tidak mengambil perbaikan di repository yang berbeda.

Setup SQL, akun admin, dan environment variable yang sudah benar tetap dapat digunakan. Panduan di bawah berlaku untuk proyek lengkap setelah 16 file ini digabungkan dengan dua file sesi yang sudah ada.

---

# SI-BANYU — paket Vercel + Supabase

Paket ini memuat website KDKMP Banyurojo, 169 foto PNG transparan, katalog, catatan belanja dengan unduhan gambar, profil, bagan organisasi, berita, dan admin. Semua berkas sumber berada langsung di akar ZIP, tanpa folder pembungkus. Ekstrak seluruh isi ZIP ke satu lokasi sebelum diunggah ke GitHub atau dijalankan lewat Vercel CLI.

## Penyimpanan yang dipakai

- Vercel: menjalankan dan menyajikan website. 169 foto awal sudah menjadi aset website; tidak perlu diunggah ulang ke Supabase.
- Supabase Database: menyimpan produk, harga, stok, profil, struktur, galeri, berita/draf, dan riwayat perubahan stok. Penulisan memakai pemeriksaan versi agar perubahan admin lain tidak tertimpa.
- Supabase Auth: login email/kata sandi milik pengelola yang masuk daftar admin.
- Supabase Storage: unggahan foto baru melalui admin. Bucket `si-banyu-media` untuk foto situs publik; jangan gunakan untuk dokumen pribadi, KK, atau lampiran rahasia. Draf teks dan data nonaktif hanya diberikan kepada sesi admin yang sah.
- Catatan belanja, jumlah pilihan, pengingat, dan anggaran tetap berada di browser pembeli. Tidak dikirim menjadi pesanan, pembayaran, atau pengurangan stok.

## 1. Siapkan Supabase

1. Buat proyek Supabase pada akun koperasi.
2. Buka SQL Editor dan jalankan `supabase-schema.sql`.
3. Jalankan `seed.sql` untuk mengisi 169 produk dan konten awal. Skrip seed memakai `ON CONFLICT DO NOTHING`, sehingga tidak menimpa konten yang sudah ada jika dijalankan ulang. `seed.json` tersedia untuk pemeriksaan data, bukan untuk diunggah sebagai gambar.
4. Buka Authentication > Users > Add user. Buat akun admin dengan email dan kata sandi sendiri. Aktifkan/konfirmasi pengguna melalui dashboard sesuai pengaturan proyek.
5. Edit email pada `admin-setup.sql`, lalu jalankan skrip itu. Pengguna yang tidak tercantum di daftar ini tidak memperoleh akses admin meskipun memiliki akun Auth.
6. Untuk situs dengan admin saja, nonaktifkan pendaftaran pengguna publik pada pengaturan Auth jika tidak diperlukan. Atur Site URL ke domain produksi setelah tersedia.
7. Salin Project URL dan publishable key dari pengaturan API proyek. Legacy `anon` key juga didukung. Jangan menggunakan `service_role`/secret key sebagai konfigurasi browser.

## 2. Deploy ke Vercel

Untuk menggunakan paket ini, ekstrak ZIP lalu unggah seluruh berkas ke akar satu repositori GitHub atau deploy lokasi hasil ekstrak memakai Vercel CLI.

Melalui GitHub:

1. Masukkan semua berkas ZIP ke akar repositori. Tidak perlu membuat folder proyek tambahan.
2. Import repositori melalui Vercel > Add New > Project.
3. Framework Preset: **Other**. Root Directory: akar repositori (`./`).
4. Tambahkan environment variables berikut untuk Production dan Preview yang akan digunakan:

| Nama | Isi |
| --- | --- |
| `SUPABASE_URL` | Project URL, contoh `https://PROYEK.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key proyek atau legacy anon key |

5. Deploy. `vercel.json` sudah menetapkan `npm ci --include=dev`, `npm run build`, dan Output Directory `dist`.
6. Buka website, lalu pilih Admin atau buka `/#admin`.
7. Masuk dengan email dan kata sandi yang dibuat pada langkah Supabase.

Folder `dist` dibuat otomatis ketika Vercel membangun website; tidak ada folder itu di dalam ZIP. Hanya hasil build yang dipublikasikan, sehingga SQL, tes, dan panduan tidak ikut menjadi halaman publik.

Jika memakai CLI, jalankan `vercel` dari lokasi hasil ekstrak, sambungkan ke proyek, isi environment variables di proyek Vercel, lalu deploy ulang. Pilihan lain: isi dua nilai publik di `config.js` sebelum build; environment variables tetap menjadi pilihan utama.

## 3. Logout otomatis 10 menit

- Batas tanpa aktivitas adalah tepat `600000` milidetik pada aplikasi.
- Mengetik, menggerakkan/menekan pointer, wheel, dan sentuhan di halaman admin memperbarui aktivitas.
- Refresh token, respons jaringan, polling, dan timer latar tidak dianggap aktivitas pengguna.
- Tab admin dalam browser yang sama berbagi timestamp aktivitas. Keluar pada satu tab mengunci tab lain.
- Saat tab kembali dari latar atau laptop bangun dari sleep, tenggat diperiksa sebelum menerima klik sebagai aktivitas baru.
- RPC dan kebijakan Storage juga memerlukan lease admin yang belum lewat10 menit. Lease yang kedaluwarsa atau dicabut tidak dapat diaktifkan kembali hanya dengan refresh token; pengguna harus masuk lagi untuk membuat sesi Auth baru.
- Antarmuka terkunci segera saat tenggat terdeteksi. Browser yang membekukan tab dapat menunda penghapusan sesi lokal sampai tab berjalan lagi; akses backend tetap memeriksa waktu server.

## 4. Menjalankan dan memeriksa paket

Memerlukan Node.js22 atau lebih baru.

```bash
npm ci --include=dev
npm test
npm run build
```

Gunakan server HTTP statis untuk membuka isi hasil build. Sumber modular ini bukan HTML mandiri yang dibuka dengan klik ganda melalui `file://`.

Tes memakai jam simulasi untuk batas10 menit dan PostgreSQL lokal berbasis WASM untuk peran, sanitasi konten publik, hak unggah, lease, pencabutan sesi, serta konflik penyimpanan. Tes tidak menggunakan akun Supabase sungguhan. Sambungan proyek Supabase/Vercel produksi tetap perlu diperiksa setelah konfigurasi diisi.

## 5. Kondisi sebelum konfigurasi diisi

Build tetap berhasil dan katalog awal dapat ditampilkan. Login admin dinonaktifkan sampai Project URL dan publishable key diisi. Paket tidak menyediakan akun/password demo yang membuka pengelolaan produksi.

## 6. Catatan konten

- Video profil sudah berada setelah hero Beranda; URL video resmi masih perlu diisi melalui admin.
- Foto Tiga Sapi490g vs daftar290g dan Tora Susu31g vs daftar30g diberi catatan konfirmasi ukuran. Harga dan stok mengikuti data yang diberikan, tidak dibuat-buat.
- Berita merupakan ringkasan dengan tautan sumber SIMKOPDES, bukan salinan penuh artikel.
- Maps dan video eksternal memerlukan internet.
- Unduh backup JSON dari admin secara berkala. Penghapusan foto dari kartu tidak otomatis menghapus objek Storage; ini menghindari foto yang masih dipakai ikut terhapus. Periksa referensi sebelum membersihkan Storage melalui dashboard.
- Integrasi website lain belum dilakukan karena kodenya belum tersedia. RPC konten dan proyek Supabase yang sama dapat menjadi dasar integrasi berikutnya.

## Referensi resmi

- https://vercel.com/docs/project-configuration/vercel-json
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/pricing
