import {defineConfig} from 'vitest/config';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},esbuild:{jsx:'automatic'},test:{include:['test/callback-control.test.tsx','test/callback-schedule.test.tsx','test/recording-continuity.test.tsx'],environment:'node',maxWorkers:1,minWorkers:1}});
