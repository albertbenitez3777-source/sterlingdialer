import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  resolve: { alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url)),
  } },
  esbuild: { jsx: 'automatic' },
  test: { include: ['test/auth-stability.test.ts', 'test/workspace-refresh.test.ts', 'test/stability-login.test.tsx', 'test/stability-isolation.test.tsx', 'test/controls-freshness.test.tsx'], environment: 'node' },
});
