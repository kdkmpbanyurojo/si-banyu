// Data helpers shared by the receipt and the admin change history.
export function selectedReceiptItems(state) {
  const products = new Map(state.products.map(product => [product.id, product]));
  return state.selection.filter(item => item.checked === true && products.has(item.productId))
    .map(item => ({ ...item, product: products.get(item.productId) }));
}

const ENTITIES = {
  products: 'Produk', articles: 'Artikel', members: 'Struktur organisasi',
  gallery: 'Galeri', timeline: 'Catatan perjalanan'
};
const FIELDS = {
  name: 'Nama', title: 'Judul', sku: 'Kode', price: 'Harga', stock: 'Stok',
  category: 'Kategori', unit: 'Satuan', active: 'Status aktif', featured: 'Produk unggulan',
  lowStockThreshold: 'Ambang stok', image: 'Gambar', photo: 'Foto', description: 'Deskripsi',
  review: 'Catatan pengecekan', subsidy: 'Aturan pembelian', position: 'Jabatan',
  group: 'Kelompok', parentId: 'Hubungan bagan', bio: 'Profil', sortOrder: 'Urutan',
  date: 'Tanggal', excerpt: 'Ringkasan', body: 'Isi', source: 'Sumber', sourceUrl: 'Tautan sumber',
  status: 'Status publikasi', sample: 'Penanda contoh', caption: 'Keterangan',
  aboutText: 'Tentang koperasi', vision: 'Visi', mission: 'Misi', values: 'Nilai bersama',
  profileDraft: 'Penanda draf profil', profileVideoUrl: 'Video profil',
  cooperativeName: 'Nama koperasi', logo: 'Logo', heroTitle: 'Judul beranda',
  heroDescription: 'Deskripsi beranda', address: 'Alamat', email: 'Email', phone: 'Telepon',
  socialLinks: 'Media sosial'
};
const OMIT_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);
const IMAGE_FIELDS = new Set(['image', 'photo', 'logo']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const short = value => String(value ?? '').slice(0, 180);
function display(value, field) {
  if (value === null || value === undefined || value === '') return 'Belum diisi';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (field === 'price' && typeof value === 'number') return 'Rp ' + value.toLocaleString('id-ID');
  if (Array.isArray(value)) return short(value.join('; '));
  if (typeof value === 'object') return 'Data diperbarui';
  return short(value);
}
function fieldChanges(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(field => !OMIT_FIELDS.has(field) && !same(before[field], after[field]));
}

export function isStockHistory(log) { return log.kind !== 'activity'; }

export function validActivityLog(log) {
  return typeof log.id === 'string' && log.id.length <= 100 &&
    typeof log.date === 'string' && Number.isFinite(Date.parse(log.date)) &&
    typeof log.reason === 'string' && log.reason.length <= 1000 &&
    typeof log.details === 'string' && log.details.length <= 6000 &&
    typeof log.actorId === 'string' && log.actorId.length <= 100 &&
    typeof log.actorEmail === 'string' && log.actorEmail.length <= 320;
}

export function appendAdminHistory(before, after, { id, date, actor, reason = '' }) {
  const previousIds = new Set(before.logs.map(log => log.id));
  const incoming = after.logs.filter(log => !previousIds.has(log.id));
  const newStock = incoming.filter(isStockHistory);
  const changes = [];
  const describe = text => changes.push(text);

  for (const [key, entity] of Object.entries(ENTITIES)) {
    const oldItems = new Map(before[key].map(item => [item.id, item]));
    const newItems = new Map(after[key].map(item => [item.id, item]));
    for (const [itemId, item] of newItems) {
      const old = oldItems.get(itemId);
      const name = short(item.name || item.title || item.caption || itemId);
      if (!old) {
        // Stock initialization already has a visible history record.
        if (key !== 'products' || !newStock.some(log => log.productId === itemId))
          describe(entity + ' ditambahkan: ' + name);
        continue;
      }
      const fields = fieldChanges(old, item).filter(field =>
        !(key === 'products' && field === 'stock' && newStock.some(log => log.productId === itemId)));
      if (!fields.length) continue;
      const details = fields.map(field => IMAGE_FIELDS.has(field)
        ? (FIELDS[field] || field) + ' diperbarui'
        : (FIELDS[field] || field) + ': ' + display(old[field], field) + ' → ' + display(item[field], field));
      describe(entity + ' diubah: ' + name + ' — ' + details.join('; '));
    }
    for (const [itemId, item] of oldItems) if (!newItems.has(itemId))
      describe(entity + ' dihapus: ' + short(item.name || item.title || item.caption || itemId));
  }
  for (const category of after.categories) if (!before.categories.includes(category))
    describe('Kategori ditambahkan: ' + short(category));
  for (const category of before.categories) if (!after.categories.includes(category))
    describe('Kategori dihapus: ' + short(category));
  const settingsFields = fieldChanges(before.settings, after.settings);
  if (settingsFields.length) describe('Pengaturan/profil diubah: ' + settingsFields.map(field => FIELDS[field] || field).join(', '));

  const activity = changes.length ? [{
    id, kind: 'activity', date, actorId: String(actor?.id || '').slice(0, 100),
    actorEmail: String(actor?.email || '').slice(0, 320), reason: String(reason || 'Perubahan data admin').slice(0, 1000),
    details: (changes.slice(0, 30).join('\n') + (changes.length > 30 ? '\nDan ' + (changes.length - 30) + ' perubahan lain.' : '')).slice(0, 6000)
  }] : [];
  // Keep existing history when restoring a backup or resetting site content.
  const all = new Map([...before.logs, ...incoming, ...activity].map(log => [log.id, log]));
  return [...all.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 1000);
}
