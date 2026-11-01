import { defineConfig } from 'vite';

// GitHub Pages: https://<user>.github.io/<repo>/ で配信するため base をリポジトリ名に合わせる
export default defineConfig({
  base: '/seesaw-sky/',
  build: { target: 'es2022', chunkSizeWarningLimit: 2600 },
});
