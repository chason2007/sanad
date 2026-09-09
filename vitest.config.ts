import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { environment: 'node', testTimeout: 60000, hookTimeout: 60000 },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
});
