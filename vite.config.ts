import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 配信する場所: Cloudflare Workers(2026-11-13〜・根元 '/') / GitHub Pages(サブパス・移行が済むまで)
//   GitHub Pages のビルドは VITE_BASE=/askul-manager/ を渡す(.github/workflows/deploy.yml)
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
});
