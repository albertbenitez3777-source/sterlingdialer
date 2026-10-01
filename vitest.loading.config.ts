import {defineConfig} from 'vitest/config';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},esbuild:{jsx:'automatic'},test:{include:['test/home-loading.test.tsx','test/auth-stability.test.ts','test/stability-login.test.tsx','test/workspace-refresh.test.ts','test/serial-poll.test.ts','test/callback-schedule.test.tsx','test/callback-control.test.tsx','test/recording-continuity.test.tsx'],environment:'node',maxWorkers:1,minWorkers:1}});
