import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedReceiptItems,appendAdminHistory,isStockHistory,validActivityLog} from './site-data.js';

const at='2026-10-31T00:00:00.000Z';
const actor={id:'admin-1',email:'pengelola@example.test'};
function state(){return {products:[{id:'p1',name:'Indomie',price:3050,stock:10,updatedAt:at}],articles:[],members:[],gallery:[],timeline:[],categories:['Makanan'],settings:{vision:'Visi',profileDraft:true},logs:[],selection:[],shoppingNote:'',budget:null}}
const log=(before,after,opts={})=>appendAdminHistory(before,after,{id:'activity-1',date:at,actor,reason:'Produk disimpan.',...opts});

test('receipt includes only checked items that still have a product; source is unchanged',()=>{
 const s=state();s.products.push({id:'p2',name:'Minyak',price:15700,stock:null});
 s.selection=[{productId:'p1',quantity:2,note:'Simpan',checked:true},{productId:'p2',quantity:1,note:'Jangan masuk',checked:false},{productId:'missing',quantity:9,checked:true}];
 const original=structuredClone(s),items=selectedReceiptItems(s);
 assert.deepEqual(items.map(x=>x.productId),['p1']);assert.equal(items[0].quantity,2);assert.equal(items[0].note,'Simpan');
 assert.equal(items.reduce((sum,x)=>sum+x.quantity*x.product.price,0),6100);assert.deepEqual(s,original);
});
test('receipt with no checks is empty and does not fall back to all products',()=>{
 const s=state();s.selection=[{productId:'p1',quantity:1,checked:false}];assert.deepEqual(selectedReceiptItems(s),[]);
});
test('checked items with an unknown price remain selected',()=>{
 const s=state();s.products[0].price=null;s.selection=[{productId:'p1',quantity:1,checked:true}];assert.equal(selectedReceiptItems(s)[0].product.price,null);
});
test('new product with unknown stock receives an activity record and actor',()=>{
 const before=state(),after=structuredClone(before);after.products.push({id:'p2',name:'Produk baru',price:1500,stock:null});
 const logs=log(before,after);assert.equal(logs.length,1);assert.match(logs[0].details,/Produk ditambahkan: Produk baru/);assert.equal(logs[0].actorEmail,actor.email);assert.equal(validActivityLog(logs[0]),true);assert.deepEqual(before.logs,[]);
});
test('stock initialization already recorded by the existing feature is not duplicated',()=>{
 const before=state(),after=structuredClone(before);after.products.push({id:'p2',name:'Produk baru',stock:5});
 after.logs=[{id:'stock-1',productId:'p2',productName:'Produk baru',before:null,after:5,date:at,reason:'Pencatatan awal produk'}];
 assert.deepEqual(log(before,after),after.logs);assert.equal(isStockHistory(after.logs[0]),true);
});
test('price/name edits are recorded; image contents are not copied into history',()=>{
 const before=state(),after=structuredClone(before);Object.assign(after.products[0],{name:'Indomie baru',price:3500,image:'data:image/png;base64,PRIVATE_IMAGE'});
 const logs=log(before,after);assert.match(logs[0].details,/Nama: Indomie → Indomie baru/);assert.match(logs[0].details,/Harga:/);assert.match(logs[0].details,/Gambar diperbarui/);assert.equal(JSON.stringify(logs).includes('PRIVATE_IMAGE'),false);
});
test('existing stock change is retained without a duplicate activity; clearing stock is captured',()=>{
 const before=state(),after=structuredClone(before);after.products[0].stock=8;after.logs=[{id:'stock-2',productId:'p1',productName:'Indomie',before:10,after:8,date:at,reason:'Barang keluar'}];
 assert.deepEqual(log(before,after),after.logs);
 const cleared=structuredClone(before);cleared.products[0].stock=null;assert.match(log(before,cleared)[0].details,/Stok: 10 → Belum diisi/);
});
test('deleting a product remains visible after it disappears from the catalog',()=>{
 const before=state(),after=structuredClone(before);after.products=[];assert.match(log(before,after)[0].details,/Produk dihapus: Indomie/);
});
test('profile, category and article changes are recorded; browser cart and timestamps are ignored',()=>{
 const before=state(),after=structuredClone(before);after.settings.profileDraft=false;after.categories.push('Minuman');after.articles.push({id:'a1',title:'Kabar baru',body:'Isi'});
 const details=log(before,after)[0].details;assert.match(details,/Penanda draf profil/);assert.match(details,/Kategori ditambahkan: Minuman/);assert.match(details,/Artikel ditambahkan: Kabar baru/);
 const personal=structuredClone(before);personal.shoppingNote='catatan';personal.selection=[{productId:'p1',checked:true,quantity:1}];personal.products[0].updatedAt='2027-01-01';assert.deepEqual(log(before,personal),[]);
});
test('previous history is preserved across reset/restore and bounded to 1000 entries',()=>{
 const before=state();before.logs=Array.from({length:1000},(_,i)=>({id:'old-'+i,kind:'activity',date:new Date(Date.parse(at)-1000-i).toISOString(),reason:'Lama',details:'Perubahan lama',actorId:'',actorEmail:''}));
 const after=structuredClone(before);after.logs=[];after.products[0].price=4000;
 const logs=log(before,after);assert.equal(logs.length,1000);assert.equal(logs[0].id,'activity-1');assert.equal(logs[1].id,'old-0');assert.equal(new Set(logs.map(x=>x.id)).size,1000);
});
test('activity records reject malformed fields and accept legacy stock separately',()=>{
 const before=state(),after=structuredClone(before);after.products[0].price=4000;const entry=log(before,after)[0];
 assert.equal(validActivityLog(entry),true);assert.equal(isStockHistory(entry),false);
 assert.equal(validActivityLog({...entry,date:'not-a-date'}),false);assert.equal(validActivityLog({...entry,details:'x'.repeat(6001)}),false);assert.equal(validActivityLog({...entry,actorEmail:null}),false);
});
