/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [svelte()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? pkg.version) },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: { include: ['src/**/*.test.ts'] },
});
