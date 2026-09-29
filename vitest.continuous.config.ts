import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: { include: ['test/admin-dialer-overview.test.tsx', 'test/continuous-operations.test.tsx'], environment: 'node', maxWorkers: 1, minWorkers: 1 },
});
