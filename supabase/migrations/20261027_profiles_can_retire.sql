-- 2026-10-27 退職予定の登録・表示の権限(ユーザー編集のチェック)。staff-retire-proxy がこの値を確かめる
alter table public.profiles add column if not exists can_retire boolean not null default false;
