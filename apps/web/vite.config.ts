import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  envDir: '../../',
  resolve: {
    alias: {
      '@zenith/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url)
      )
    }
  },
  server: {
    port: 5173
  }
});
