import { defineConfig } from 'vitest/config';
import path from 'path';
import { config } from 'dotenv';

// Load .env file
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});