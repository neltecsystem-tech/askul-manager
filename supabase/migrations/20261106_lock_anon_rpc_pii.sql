-- 2026-11-06 本番適用済み(Supabase CLI の db query で実行)
-- ログインなしで氏名・電話番号などを取得できた関数を塞ぐ。
--
-- 影響: 次の呼び出し元は pay-statement-viewer のメンバー管理画面だけで、この画面は現在非表示。
-- 再び使う場合は、NELTEC 社員だけを通すサーバー経由にする。admin 権限だけでは委託ドライバーも通るので不可。

revoke execute on function public.get_company_list() from public, anon;
grant execute on function public.get_company_list() to authenticated, service_role;

revoke execute on function public.get_biz_type_map() from public, anon, authenticated;
revoke execute on function public.get_driver_company_map() from public, anon, authenticated;
revoke execute on function public.get_driver_site_map() from public, anon, authenticated;
grant execute on function public.get_biz_type_map() to service_role;
grant execute on function public.get_driver_company_map() to service_role;
grant execute on function public.get_driver_site_map() to service_role;
