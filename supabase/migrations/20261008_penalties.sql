-- 違約金 (2026-10-08)
-- 特別日当の画面から種別「違約金」で登録する。特別日当(Googleシート)には書かないので、
-- このツールの支払計算には入らない。控除は会計(workchat)が service_role で読んで行う。
create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  driver_name text not null,
  amount integer not null check (amount > 0),
  reason text not null default '',
  inputter text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists penalties_event_date_idx on public.penalties (event_date);
alter table public.penalties enable row level security;
drop policy if exists penalties_admin_all on public.penalties;
create policy penalties_admin_all on public.penalties for all to authenticated
  using (is_admin()) with check (is_admin());
revoke all on public.penalties from anon;
