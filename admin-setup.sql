-- 1. Buat akun melalui Supabase Dashboard > Authentication > Users > Add user.
-- 2. Ganti email di bawah dengan email akun yang baru dibuat, lalu Run.
-- Kata sandi dibuat langsung di Supabase; tidak disimpan dalam berkas proyek.
do $$
declare admin_email text := 'GANTI_DENGAN_EMAIL_ADMIN'; admin_id uuid;
begin
  select id into admin_id from auth.users where lower(email)=lower(admin_email);
  if admin_id is null then raise exception 'Akun belum ditemukan. Ganti email dan buat pengguna di Authentication > Users terlebih dahulu.'; end if;
  insert into si_banyu_private.admin_users(user_id) values(admin_id) on conflict(user_id) do nothing;
end $$;
