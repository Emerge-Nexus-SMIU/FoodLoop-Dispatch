import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', testTimeout: 20000, hookTimeout: 30000, fileParallelism: false },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
