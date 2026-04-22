# アスクル管理ツール (askul-manager)

アスクル配送業務委託向けの管理ツール。ドライバー支払い、アスクル請求、シフト・コース編成を管理する。

## 技術スタック

- React 19 + Vite + TypeScript
- Supabase (Auth + DB + RLS)
- GitHub Pages デプロイ

## セットアップ

```bash
npm install
cp .env.example .env.local   # Supabase URL / anon key を設定
npm run dev
```

## ビルド

```bash
npm run build
```

## ディレクトリ構成

```
src/
  lib/           Supabase クライアント、認証コンテキスト等
  pages/         画面コンポーネント
  types/         TypeScript 型定義
```
