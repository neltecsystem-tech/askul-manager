import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages でサブパス配信するため base を指定（repo 名に合わせる）
export default defineConfig({
  plugins: [react()],
  base: '/askul-manager/',
});
