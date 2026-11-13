-- 🔒 品質報告(quality_reports)を未ログインでも読めた → 管理者だけ(2026-11-13 セキュリティ点検 M13)。
-- 読む画面は QualityReportPage(RequireAdmin)だけ。中身は集計値のみだったが、ドライバー別の数字の元になるので閉じる。
drop policy if exists read_quality_reports on public.quality_reports;
create policy read_quality_reports on public.quality_reports for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'super_admin')));
revoke select on public.quality_reports from anon;
