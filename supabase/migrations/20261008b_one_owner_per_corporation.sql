-- 法人代表(corporation_owner)は1つの法人に1名だけにする(配送管理と同じ決まり。2026-10-08)。
-- 配送管理でポリヌス／ポリヌス②が2人とも法人代表になっていて、支払先が食い違い二重計上が起きた。
-- アスクル側は現時点で重なりは無い(法人代表4名・すべて別法人)ので、決まりだけ入れる。
-- 法人の単位 = インボイス番号。番号が無ければ会社名。
create unique index if not exists profiles_one_owner_per_corporation
  on public.profiles ((coalesce(nullif(btrim(invoice_number), ''), btrim(company_name))))
  where business_type = 'corporation_owner'
    and coalesce(nullif(btrim(invoice_number), ''), nullif(btrim(company_name), '')) is not null;

comment on index public.profiles_one_owner_per_corporation is
  '法人代表は1法人(インボイス番号、無ければ会社名)に1名まで。2026-10-08';
