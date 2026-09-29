import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['test/zadarma-history-worker.test.ts'],environment:'node',maxWorkers:1,minWorkers:1}});
