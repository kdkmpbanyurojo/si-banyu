import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import config from './config.js';

const url=(process.env.SUPABASE_URL || config.supabaseUrl || '').trim();
const key=(process.env.SUPABASE_PUBLISHABLE_KEY || config.supabasePublishableKey || '').trim();
if (Boolean(url)!==Boolean(key)) throw new Error('Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY sekaligus.');
if (url && (!url.startsWith('https://') || !/\.supabase\.(co|in)$/.test(new URL(url).hostname))) throw new Error('SUPABASE_URL harus memakai URL HTTPS proyek Supabase.');
if (key) {
  let role=''; try { role=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role || ''; } catch {}
  if (key.startsWith('sb_secret_') || role==='service_role' || (!key.startsWith('sb_publishable_') && role!=='anon')) throw new Error('Gunakan publishable/anon key, bukan service_role atau secret key.');
}
await rm('dist',{recursive:true,force:true}); await mkdir('dist');
await build({ entryPoints:['app.js'], outfile:'dist/app.js', bundle:true, platform:'browser', format:'esm', target:['safari16','chrome110'], minify:true, legalComments:'none', define:{__SI_SUPABASE_URL__:JSON.stringify(url),__SI_SUPABASE_KEY__:JSON.stringify(key)} });
await Promise.all(['index.html','styles.css'].map(name=>copyFile(name,'dist/'+name)));
const html=await readFile('dist/index.html','utf8');
if (!html.includes('SI-BANYU')) throw new Error('Identitas aplikasi tidak ditemukan.');
await writeFile('dist/robots.txt','User-agent: *\nAllow: /\n');
console.log('Build SI-BANYU selesai. Mode penyimpanan: '+(url?'Supabase':'katalog awal; login admin nonaktif sampai Supabase dikonfigurasi.'));
