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

## 締めの流れと cron (askul DB の pg_cron)

```
25日22:00  仮確定  → その場で会計(支払計算書)へ反映
25〜末日   修正があれば確定し直す → 会計もその都度作り直す
末日22:00  本確定(force) → 最終値で会計を更新
1日/11日   支払通知の発行 → ここで初めてドライバーが明細ビューアで見られる
```

| job | schedule (UTC) | JST | 中身 |
|---|---|---|---|
| askul-finalize | `0 13 25 * *` | 25日 22:00 | **仮確定**。finalize-askul を `dry_run:false` で叩く |
| askul-finalize-retry | `0 13 26,27 * *` | 26/27日 22:00 | **その月の確定行が0件のときだけ** 仮確定を叩く拾い直し(手修正の上書き防止) |
| askul-finalize-final | `0 13 28-31 * *` | 月末日 22:00 | **本確定**。`force:true` で上書き再確定 → 最終値で会計を更新 |
| askul-reflect | `0 1 * * *` | 毎日 10:00 | 保険。未反映(=会計未計上)の行が残っている月を拾って反映する |

- **確定したら会計に出す**(`reflected_at` をその場でセット + acc-autofill を叩く)。
  `reflected_at` は「会計に出した」印であって公開フラグではない。
- **ドライバー公開は支払通知の発行**で決まる(pay-statement-by-phone の公開ゲート・2026-08-05)。
  公開条件 = 自分宛の通知が発行済み or 実績月の翌月11日9時を過ぎた。
- **上書きロックの条件は「支払通知を発行済みか」**。発行後は通知額と食い違うので確定し直さない
  (直すときは画面の「変更を反映」= `force:true`)。
  ※ 以前は `reflected_at` でロックしていたため、仮確定した瞬間に上書き不可になり
    「修正して反映」が回らなかった。
- 会計の自動更新は**当月/前月のみ**。それより古い月は締め済みなので触らない。
- pg_cron は `net.http_post` を投げた時点で成功扱いになる。**EFが500でも job_run_details は succeeded**。
  失敗の実体は `net._http_response` を見る。加えて finalize-askul は失敗時に
  常設アラート `askul_finalize_failed:<YYYY-MM>` を上げる(成功で自動解消)。
- 2026-08-25 の自動確定は Google Sheets 503 で落ちた。以降 Sheets/認証の呼び出しは
  408/429/5xx を 1s→3s→8s→15s で再試行する。

### 反映が月末1回きりだった頃の穴 (2026-08-27 に解消)
確定が反映日(その月の末日)より後になった月は、**永久に未反映のまま取り残される**バグがあった。
2026-06 は 7/17 確定で 6/30 を過ぎており、ずっと未反映＝会計の自動入力に出ない状態だった
(2026-05 も同様)。2026-05(14件)・2026-06(15件) は 2026-08-27 に反映済み(会計は締め済みのため未変更)。
