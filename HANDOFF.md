# Askul Manager 引き継ぎノート

別マシンで作業を続けるための引き継ぎ。最終更新 2026-06-19。

## 概要・スタック
- アスクル配送業務委託管理。React + Vite + TypeScript + Supabase。歩合給/個建+車建/インボイス対応。
- Supabase = **askul (erfcsnzdooswgpvgrapb)** ※会計/NexPortとは別プロジェクト。
- GitHub: `neltecsystem-tech/askul-manager`。

## Macでの立ち上げ
1. `git clone https://github.com/neltecsystem-tech/askul-manager.git`
2. `npm install`
3. `.env.local` を作成(`.env.example` をコピーして値を入れる。git管理外):
   ```
   VITE_SUPABASE_URL=https://erfcsnzdooswgpvgrapb.supabase.co
   VITE_SUPABASE_ANON_KEY=<askulのanonキー(別途共有)>
   ```
4. `npm run dev`。

## デプロイ
- **`git push origin main` → GitHub Actions `deploy.yml`** で自動デプロイ。

## 関連メモ
- closed_payment_statements / monthly-balance EF が会計アプリの支払計算書自動入力ソース。
- 会計連携用 admin `acc-sync@askul.local`(EFシークレット ASKUL_SYNC_EMAIL/PASSWORD)あり。
- DB容量逼迫時の退避先 Google Drive あり(reference参照)。
- 各月取扱個数ページ(締め21-20)。

## 必要シークレット(git管理外)
- askul の anon キー(.env.local)。DB直接操作は Supabase PAT(別途共有)。
