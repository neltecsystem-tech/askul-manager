-- 🛡 支払明細のあるドライバーを完全削除させない + 名簿の削除・無効化を記録する(2026-10-30)
-- 発端: 金子伸也(ラストワンマイル・パートナーズ)が「ドライバー管理 → 完全削除」で消され、
--       closed_payment_statements(ON DELETE CASCADE)の8月・9月の確定明細と稼働記録まで消えた。
--       会計には金額が残ったため「明細ビューアとの差分」で発覚。誰がいつ消したかの記録も無かった。
-- 対策:
--   1. profiles の削除前に、確定明細・稼働記録・配送実績があれば止める(画面・関数・SQL どこから消しても止まる。
--      auth ユーザーの削除も profiles へ連鎖するので、同じく止まって丸ごと取り消される)
--   2. closed_payment_statements の外部キーを CASCADE → RESTRICT(上の判定をすり抜けても明細は消えない)
--   3. profile_audit に削除・無効化/有効化・改名を記録(操作した人がわかれば actor に入る)

-- 記録の表(書き足すだけ。管理者だけ読める)
create table if not exists public.profile_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text not null,                 -- deleted / deactivated / activated / renamed / delete_blocked / delete_requested
  profile_id uuid,
  full_name text,
  phone text,
  detail jsonb not null default '{}'::jsonb,
  actor uuid,                           -- auth.uid()(サービスキーからの操作では空)
  actor_name text
);
alter table public.profile_audit enable row level security;
revoke all on public.profile_audit from anon;
drop policy if exists profile_audit_admin_read on public.profile_audit;
create policy profile_audit_admin_read on public.profile_audit for select to authenticated using (public.is_admin());
-- 画面から「削除を依頼した人」を書く(管理者だけ)
drop policy if exists profile_audit_admin_insert on public.profile_audit;
create policy profile_audit_admin_insert on public.profile_audit for insert to authenticated
  with check (public.is_admin() and action = 'delete_requested' and actor = auth.uid());
grant select, insert on public.profile_audit to authenticated;
grant usage, select on sequence public.profile_audit_id_seq to authenticated;

create or replace function public.profile_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select full_name from profiles where id = auth.uid()
$$;

-- 1. 削除の前に確かめる
create or replace function public.guard_profile_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n_cps int; n_work int; n_deliv int;
begin
  select count(*) into n_cps from closed_payment_statements where driver_id = old.id;
  select count(*) into n_work from work_records where driver_id = old.id;
  select count(*) into n_deliv from delivery_records where driver_id = old.id;
  if n_cps > 0 or n_work > 0 or n_deliv > 0 then
    insert into profile_audit(action, profile_id, full_name, phone, detail, actor, actor_name)
    values ('delete_blocked', old.id, old.full_name, old.phone,
      jsonb_build_object('closed_payment_statements', n_cps, 'work_records', n_work, 'delivery_records', n_deliv),
      auth.uid(), profile_actor_name());
    raise exception '「%」は支払明細%件・稼働記録%件・配送実績%件があるため完全削除できません。契約終了・退任は「編集」で【有効】のチェックを外してください（過去の支払根拠を残すため）。',
      coalesce(old.full_name, ''), n_cps, n_work, n_deliv
      using errcode = 'P0001';
  end if;
  insert into profile_audit(action, profile_id, full_name, phone, detail, actor, actor_name)
  values ('deleted', old.id, old.full_name, old.phone,
    jsonb_build_object('company_name', old.company_name, 'business_type', old.business_type, 'role', old.role),
    auth.uid(), profile_actor_name());
  return old;
end $$;
drop trigger if exists trg_guard_profile_delete on public.profiles;
create trigger trg_guard_profile_delete before delete on public.profiles
  for each row execute function public.guard_profile_delete();

-- 3. 無効化・有効化・改名の記録
create or replace function public.audit_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.active, true) is distinct from coalesce(new.active, true) then
    insert into profile_audit(action, profile_id, full_name, phone, detail, actor, actor_name)
    values (case when coalesce(new.active, true) then 'activated' else 'deactivated' end, new.id, new.full_name, new.phone, '{}'::jsonb, auth.uid(), profile_actor_name());
  end if;
  if coalesce(old.full_name, '') is distinct from coalesce(new.full_name, '') then
    insert into profile_audit(action, profile_id, full_name, phone, detail, actor, actor_name)
    values ('renamed', new.id, new.full_name, new.phone, jsonb_build_object('from', old.full_name, 'to', new.full_name), auth.uid(), profile_actor_name());
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_profile_update on public.profiles;
create trigger trg_audit_profile_update after update on public.profiles
  for each row execute function public.audit_profile_update();

-- 2. 確定明細は名簿を消しても消えないように(CASCADE → RESTRICT)
alter table public.closed_payment_statements drop constraint if exists closed_payment_statements_driver_id_fkey;
alter table public.closed_payment_statements
  add constraint closed_payment_statements_driver_id_fkey foreign key (driver_id) references public.profiles(id) on delete restrict;
