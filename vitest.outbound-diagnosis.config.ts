import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: { include: ['test/outbound-component-diagnosis.test.tsx', 'test/zadarma-engine.test.ts', 'test/zadarma-api.test.ts', 'test/zadarma-phone.test.ts'], environment: 'node', maxWorkers: 1, minWorkers: 1 },
});
