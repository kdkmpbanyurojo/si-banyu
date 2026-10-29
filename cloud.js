import { createClient } from '@supabase/supabase-js';
export const CONTENT_KEYS = ['schemaVersion','products','categories','articles','members','gallery','timeline','logs','settings'];
export function contentOf(state) { return Object.fromEntries(CONTENT_KEYS.map(k => [k, structuredClone(state[k])])); }
export function jwtSessionId(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id || ''; } catch { return ''; }
}
const url = __SI_SUPABASE_URL__, key = __SI_SUPABASE_KEY__;
export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key, { auth: { storageKey:'si-banyu-auth', persistSession:true, autoRefreshToken:true, detectSessionInUrl:false } }) : null;
export function friendlyCloudError(error) {
  if (error?.message?.includes('SI_IDLE') || error?.code === '42501') return 'Sesi admin berakhir atau akses ditolak. Silakan masuk kembali.';
  if (error?.message?.includes('SI_CONFLICT')) return 'Data telah diubah admin lain. Muat data terbaru sebelum menyimpan lagi.';
  return error?.message || 'Koneksi ke penyimpanan gagal. Perubahan belum tersimpan.';
}
export async function rpc(name, params = {}) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  let response;try{response=await supabase.rpc(name, params).abortSignal(controller.signal)}finally{clearTimeout(timer)}
  const { data, error } = response;
  if (error) { const problem = new Error(friendlyCloudError(error)); problem.code=error.code; problem.cause=error; throw problem; }
  return data;
}
export async function uploadPublicImage(dataUrl) {
  if (!supabase || !dataUrl.startsWith('data:image/')) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = crypto.randomUUID()+'.'+extension;
  const { error } = await supabase.storage.from('si-banyu-media').upload(path, blob, { upsert:false, contentType:blob.type, cacheControl:'31536000' });
  if (error) throw new Error(friendlyCloudError(error));
  return supabase.storage.from('si-banyu-media').getPublicUrl(path).data.publicUrl;
}
export async function uploadContentImages(content) {
  const copy=structuredClone(content), cache=new Map();
  async function replace(object, field) {
    const value=object[field];
    if (typeof value!=='string' || !value.startsWith('data:image/')) return;
    if (!cache.has(value)) cache.set(value, await uploadPublicImage(value));
    object[field]=cache.get(value);
  }
  for (const p of copy.products) await replace(p,'image');
  for (const a of copy.articles) await replace(a,'image');
  for (const m of copy.members) await replace(m,'photo');
  for (const g of copy.gallery) await replace(g,'image');
  await replace(copy.settings,'logo');
  return copy;
}
