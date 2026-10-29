import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('database roles, sanitization, optimistic locking and ten-minute leases',async()=>{
 const db=new PGlite();
 const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 let sid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await db.exec(`
 create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz default now());
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id serial primary key,bucket_id text not null,name text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated;
 grant all on storage.objects to anon,authenticated;grant usage,select on sequence storage.objects_id_seq to anon,authenticated;
 create policy legacy_broad_allow on storage.objects for all to anon,authenticated using(true) with check(true);
 insert into auth.users values('${admin}','admin@example.test'),('${other}','other@example.test');
 insert into auth.sessions(id,user_id) values('${sid}','${admin}');
 `);
 await db.exec(await readFile('supabase-schema.sql','utf8'));
 await db.exec(await readFile('seed.sql','utf8'));
 // Migration/seed idempotency must not overwrite content or whitelist.
 await db.exec(await readFile('supabase-schema.sql','utf8'));
 await db.exec(await readFile('seed.sql','utf8'));
 await db.exec(`insert into si_banyu_private.admin_users(user_id) values('${admin}')`);
 async function as(role,user=admin,session=sid){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:session})]);await db.exec('set role '+role)}
 async function owner(){await db.exec('reset role')}
 const denied=async promise=>assert.rejects(promise,e=>e.code==='42501');
 await as('anon');
 let row=(await db.query('select public.si_banyu_get_public_content() as result')).rows[0].result;
 assert.equal(row.content.products.length,169);assert.equal(row.content.articles.length,3);assert.deepEqual(row.content.logs,[]);
 await denied(db.query('select * from si_banyu_private.site_content'));
 await denied(db.query('select public.si_banyu_open_session()'));
 await denied(db.query("insert into storage.objects(bucket_id,name) values('si-banyu-media','anon.png')"));
 await as('authenticated',other);
 await denied(db.query('select public.si_banyu_open_session()'));
 await denied(db.query('select public.si_banyu_get_admin_content()'));
 await denied(db.query("insert into storage.objects(bucket_id,name) values('si-banyu-media','unauthorized.png')"));
 await as('authenticated');
 await db.query('select public.si_banyu_open_session()');
 const first=(await db.query('select public.si_banyu_get_admin_content() as result')).rows[0].result;
 await db.query("insert into storage.objects(bucket_id,name) values('si-banyu-media','authorized.png')");
 const content=structuredClone(first.content);
 content.products[0].active=false;content.products[1].internalSecret='not-public';content.settings.internalSecret='not-public';
 content.members[0].active=false;content.articles.push({...content.articles[0],id:'draft-secret',status:'draft',body:'private-draft-text'});
 content.logs=[{internal:'private-log'}];
 const [one,two]=await Promise.allSettled([
  db.query('select public.si_banyu_save_content($1::jsonb,$2) as result',[JSON.stringify(content),first.revision]),
  db.query('select public.si_banyu_save_content($1::jsonb,$2) as result',[JSON.stringify(content),first.revision])
 ]);
 assert.equal([one,two].filter(x=>x.status==='fulfilled').length,1);
 assert.equal([one,two].find(x=>x.status==='rejected').reason.code,'40001');
 await assert.rejects(db.query('select public.si_banyu_save_content($1::jsonb,null)',[JSON.stringify(content)]),e=>e.code==='40001');
 await assert.rejects(db.query('select public.si_banyu_save_content(null,2)'));
 await assert.rejects(db.query('select public.si_banyu_save_content($1::jsonb,2)',[JSON.stringify({...content,schemaVersion:undefined})]));
 await as('anon');row=(await db.query('select public.si_banyu_get_public_content() as result')).rows[0].result;
 assert.equal(row.content.products.length,168);assert.equal(row.content.members.length,9);assert.equal(row.content.articles.length,3);
 assert.equal(JSON.stringify(row).includes('private-draft-text'),false);assert.equal(JSON.stringify(row).includes('internalSecret'),false);assert.deepEqual(row.content.logs,[]);
 await owner();await db.exec(`update si_banyu_private.admin_sessions set last_activity=clock_timestamp()-interval '600 seconds' where session_id='${sid}'`);
 await as('authenticated');
 for(const name of ['si_banyu_touch_session','si_banyu_get_admin_content','si_banyu_open_session'])await denied(db.query('select public.'+name+'()'));
 await denied(db.query('select public.si_banyu_save_content($1::jsonb,2)',[JSON.stringify(content)]));
 await denied(db.query("insert into storage.objects(bucket_id,name) values('si-banyu-media','expired.png')"));
 // Fresh JWT iat would not change session_id or reopen a tombstoned lease.
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:admin,session_id:sid,iat:Math.floor(Date.now()/1000)})]);
 await denied(db.query('select public.si_banyu_open_session()'));
 await owner();sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';await db.exec(`insert into auth.sessions(id,user_id) values('${sid}','${admin}')`);
 await as('authenticated');await db.query('select public.si_banyu_open_session()');await db.query('select public.si_banyu_touch_session()');
 await db.query('select public.si_banyu_close_session()');await denied(db.query('select public.si_banyu_open_session()'));
 await owner();sid='cccccccc-cccc-4ccc-8ccc-cccccccccccc';await db.exec(`insert into auth.sessions(id,user_id) values('${sid}','${admin}')`);
 await as('authenticated');await db.query('select public.si_banyu_open_session()');
 await owner();await db.exec(`delete from auth.sessions where id='${sid}'`);
 await as('authenticated');await denied(db.query('select public.si_banyu_get_admin_content()'));await denied(db.query("insert into storage.objects(bucket_id,name) values('si-banyu-media','replayed-token.png')"));
 // Gates must leave unrelated buckets governed by their existing policies.
 await as('anon');await db.query("insert into storage.objects(bucket_id,name) values('another-app','allowed-by-legacy.png')");
 await db.close();
});
