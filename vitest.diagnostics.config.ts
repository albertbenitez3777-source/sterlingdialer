import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['test/zadarma-diagnostics.test.ts'],environment:'node',maxWorkers:1,minWorkers:1}});
