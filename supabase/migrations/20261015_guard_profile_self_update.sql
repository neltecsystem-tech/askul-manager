-- 本人によるプロフィールの書き換えを、パスワード関連の列だけに制限する (2026-10-15)
-- それまでは「自分の行なら何でも更新できる」ポリシーだけで、ドライバーが自分の role を 'admin' に書き換えれば
-- 管理者になれた(is_admin() はまさにこの列を見ている)。
-- 管理者・サーバー(service_role 等)は従来どおり。本人が変えてよいのは current_password / must_change_password / updated_at だけ。
-- 🚨 SECURITY INVOKER のまま(definer にすると current_user が所有者になり、誰でも素通りしてしまう)
create or replace function public.guard_profile_self_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;   -- service_role・postgres など
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.active) then return new; end if;
  if (to_jsonb(new) - array['current_password', 'must_change_password', 'updated_at'])
     is distinct from (to_jsonb(old) - array['current_password', 'must_change_password', 'updated_at']) then
    raise exception '自分のプロフィールで変更できるのはパスワードだけです' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_self_update on public.profiles;
create trigger trg_guard_profile_self_update before update on public.profiles
  for each row execute function public.guard_profile_self_update();
