-- SI-BANYU: jalankan sekali di SQL Editor proyek Supabase milik koperasi.
-- Skrip dapat dijalankan ulang; tidak menghapus konten atau pengguna.
begin;
create schema if not exists si_banyu_private;
revoke all on schema si_banyu_private from public, anon, authenticated;

create table if not exists si_banyu_private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists si_banyu_private.admin_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_activity timestamptz not null default clock_timestamp(),
  revoked boolean not null default false
);
create table if not exists si_banyu_private.site_content (
  id integer primary key check(id=1),
  content jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table si_banyu_private.admin_users enable row level security;
alter table si_banyu_private.admin_sessions enable row level security;
alter table si_banyu_private.site_content enable row level security;
revoke all on all tables in schema si_banyu_private from public, anon, authenticated;

create or replace function si_banyu_private.current_session_id()
returns uuid language plpgsql stable set search_path='' as $$
begin return nullif(auth.jwt()->>'session_id','')::uuid;
exception when invalid_text_representation then return null;
end $$;

create or replace function public.si_banyu_can_manage()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from si_banyu_private.admin_sessions s
    join si_banyu_private.admin_users a on a.user_id=s.user_id
    join auth.sessions active_session on active_session.id=s.session_id and active_session.user_id=s.user_id
    where s.session_id=si_banyu_private.current_session_id()
      and s.user_id=auth.uid() and not s.revoked
      and s.last_activity > statement_timestamp()-interval '10 minutes'
  );
$$;

create or replace function public.si_banyu_open_session()
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid:=si_banyu_private.current_session_id(); row_session si_banyu_private.admin_sessions%rowtype;
begin
  if auth.uid() is null or sid is null or not exists(select 1 from si_banyu_private.admin_users where user_id=auth.uid()) then
    raise exception 'SI_IDLE: akun tidak memiliki hak admin' using errcode='42501';
  end if;
  if not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid()) then
    raise exception 'SI_IDLE: sesi Auth sudah berakhir' using errcode='42501';
  end if;
  select * into row_session from si_banyu_private.admin_sessions where session_id=sid for update;
  if found then
    if row_session.user_id<>auth.uid() or row_session.revoked or row_session.last_activity<=clock_timestamp()-interval '10 minutes' then
      raise exception 'SI_IDLE: sesi kedaluwarsa; masuk kembali dengan kata sandi' using errcode='42501';
    end if;
    -- Restore/refresh never resets inactivity.
  else
    if not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid() and created_at>clock_timestamp()-interval '2 minutes') then
      raise exception 'SI_IDLE: masuk kembali untuk memulai sesi baru' using errcode='42501';
    end if;
    insert into si_banyu_private.admin_sessions(session_id,user_id) values(sid,auth.uid())
      on conflict(session_id) do nothing;
    select * into row_session from si_banyu_private.admin_sessions where session_id=sid;
    if row_session.revoked or row_session.last_activity<=clock_timestamp()-interval '10 minutes' then
      raise exception 'SI_IDLE: sesi tidak dapat diaktifkan kembali' using errcode='42501';
    end if;
  end if;
  return jsonb_build_object('last_activity',row_session.last_activity,'expires_at',row_session.last_activity+interval '10 minutes','server_now',clock_timestamp());
end $$;

create or replace function public.si_banyu_touch_session()
returns jsonb language plpgsql security definer set search_path='' as $$
declare touched timestamptz;
begin
  if not public.si_banyu_can_manage() then raise exception 'SI_IDLE: sesi berakhir' using errcode='42501'; end if;
  update si_banyu_private.admin_sessions set last_activity=clock_timestamp()
    where session_id=si_banyu_private.current_session_id() and user_id=auth.uid()
      and not revoked and last_activity>clock_timestamp()-interval '10 minutes'
    returning last_activity into touched;
  if touched is null then raise exception 'SI_IDLE: sesi berakhir' using errcode='42501'; end if;
  return jsonb_build_object('last_activity',touched,'expires_at',touched+interval '10 minutes','server_now',clock_timestamp());
end $$;

create or replace function public.si_banyu_close_session()
returns void language sql security definer set search_path='' as $$
  update si_banyu_private.admin_sessions set revoked=true
    where session_id=si_banyu_private.current_session_id() and user_id=auth.uid();
$$;

create or replace function public.si_banyu_get_admin_content()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.si_banyu_can_manage() then raise exception 'SI_IDLE: sesi berakhir' using errcode='42501'; end if;
  select jsonb_build_object('content',content,'revision',revision,'updated_at',updated_at) into result
    from si_banyu_private.site_content where id=1;
  return result;
end $$;

create or replace function public.si_banyu_save_content(p_content jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; k text; item jsonb;
begin
  if not public.si_banyu_can_manage() then raise exception 'SI_IDLE: sesi berakhir' using errcode='42501'; end if;
  if jsonb_typeof(p_content) is distinct from 'object' or p_content->>'schemaVersion' is distinct from '1' or pg_column_size(p_content)>5242880 then
    raise exception 'SI_INVALID: format atau ukuran konten tidak valid';
  end if;
  foreach k in array array['products','categories','articles','members','gallery','timeline','logs'] loop
    if jsonb_typeof(p_content->k) is distinct from 'array' then raise exception 'SI_INVALID: kolom % harus daftar',k; end if;
    if jsonb_array_length(p_content->k)>(case when k='products' then 2000 else 1000 end) then raise exception 'SI_INVALID: daftar terlalu panjang'; end if;
  end loop;
  if jsonb_typeof(p_content->'settings') is distinct from 'object' or jsonb_array_length(p_content->'categories')=0 then raise exception 'SI_INVALID: pengaturan tidak valid'; end if;
  for item in select value from jsonb_array_elements(p_content->'products') loop
    if jsonb_typeof(item->'active') is distinct from 'boolean' or jsonb_typeof(item->'name') is distinct from 'string' or jsonb_typeof(item->'id') is distinct from 'string' then raise exception 'SI_INVALID: produk tidak valid'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_content->'articles') loop
    if item->>'status' not in ('draft','published') or item->>'status' is null then raise exception 'SI_INVALID: status artikel tidak valid'; end if;
  end loop;
  -- Shopping notes and authentication/session data are never stored here.
  p_content=jsonb_build_object('schemaVersion',1,'products',p_content->'products','categories',p_content->'categories','articles',p_content->'articles','members',p_content->'members','gallery',p_content->'gallery','timeline',p_content->'timeline','logs',p_content->'logs','settings',p_content->'settings');
  update si_banyu_private.site_content set content=p_content,revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid()
    where id=1 and revision=p_expected_revision
    returning jsonb_build_object('content',content,'revision',revision,'updated_at',updated_at) into result;
  if result is null then raise exception 'SI_CONFLICT: muat data terbaru sebelum menyimpan' using errcode='40001'; end if;
  return result;
end $$;

create or replace function si_banyu_private.pick_fields(p_object jsonb,p_fields text[])
returns jsonb language sql immutable strict set search_path='' as $$
  select coalesce(jsonb_object_agg(k,p_object->k) filter(where p_object ? k),'{}'::jsonb) from unnest(p_fields) k;
$$;

create or replace function public.si_banyu_get_public_content()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('revision',s.revision,'content',jsonb_build_object(
    'schemaVersion',1,'settings',si_banyu_private.pick_fields(s.content->'settings',array['cooperativeName','logo','heroTitle','heroDescription','aboutText','vision','mission','profileDraft','address','email','phone','socialLinks','profileVideoUrl','values']),'categories',s.content->'categories',
    'products',coalesce((select jsonb_agg(si_banyu_private.pick_fields(p,array['id','sku','name','price','unit','category','stock','lowStockThreshold','active','featured','image','description','review','subsidy','createdAt','updatedAt'])) from jsonb_array_elements(s.content->'products') p where p->>'active'='true'),'[]'::jsonb),
    'articles',coalesce((select jsonb_agg(si_banyu_private.pick_fields(a,array['id','title','category','date','excerpt','body','source','sourceUrl','image','status','sample'])) from jsonb_array_elements(s.content->'articles') a where a->>'status'='published'),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(si_banyu_private.pick_fields(m,array['id','name','position','group','parentId','photo','bio','sortOrder','active'])) from jsonb_array_elements(s.content->'members') m where m->>'active'='true'),'[]'::jsonb),
    'gallery',coalesce((select jsonb_agg(si_banyu_private.pick_fields(g,array['id','image','caption','date','category'])) from jsonb_array_elements(s.content->'gallery') g),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(si_banyu_private.pick_fields(t,array['id','date','title','description','sample'])) from jsonb_array_elements(s.content->'timeline') t),'[]'::jsonb),'logs','[]'::jsonb
  )) from si_banyu_private.site_content s where s.id=1;
$$;

revoke all on function si_banyu_private.current_session_id() from public,anon,authenticated;
revoke all on function si_banyu_private.pick_fields(jsonb,text[]) from public,anon,authenticated;
revoke all on function public.si_banyu_can_manage() from public,anon,authenticated;
revoke all on function public.si_banyu_open_session() from public,anon,authenticated;
revoke all on function public.si_banyu_touch_session() from public,anon,authenticated;
revoke all on function public.si_banyu_close_session() from public,anon,authenticated;
revoke all on function public.si_banyu_get_admin_content() from public,anon,authenticated;
revoke all on function public.si_banyu_save_content(jsonb,bigint) from public,anon,authenticated;
revoke all on function public.si_banyu_get_public_content() from public,anon,authenticated;
grant execute on function public.si_banyu_get_public_content() to anon,authenticated;
grant execute on function public.si_banyu_can_manage(),public.si_banyu_open_session(),public.si_banyu_touch_session(),public.si_banyu_close_session(),public.si_banyu_get_admin_content(),public.si_banyu_save_content(jsonb,bigint) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('si-banyu-media','si-banyu-media',true,4194304,array['image/png','image/jpeg','image/webp'])
  on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists si_banyu_media_allow on storage.objects;
create policy si_banyu_media_allow on storage.objects as permissive for all to authenticated
  using(bucket_id='si-banyu-media' and public.si_banyu_can_manage())
  with check(bucket_id='si-banyu-media' and public.si_banyu_can_manage());
-- Restrictive gates also protect this bucket if another app has broad permissive policies.
drop policy if exists si_banyu_media_auth_gate on storage.objects;
create policy si_banyu_media_auth_gate on storage.objects as restrictive for all to authenticated
  using(bucket_id<>'si-banyu-media' or public.si_banyu_can_manage())
  with check(bucket_id<>'si-banyu-media' or public.si_banyu_can_manage());
drop policy if exists si_banyu_media_anon_gate on storage.objects;
create policy si_banyu_media_anon_gate on storage.objects as restrictive for all to anon
  using(bucket_id<>'si-banyu-media') with check(bucket_id<>'si-banyu-media');
commit;

-- Setelah membuat pengguna admin di Authentication > Users, jalankan terpisah:
-- insert into si_banyu_private.admin_users(user_id)
-- select id from auth.users where lower(email)=lower('EMAIL_ADMIN_ANDA')
-- on conflict(user_id) do nothing;
-- Tidak ada kata sandi/default admin di paket ini.
