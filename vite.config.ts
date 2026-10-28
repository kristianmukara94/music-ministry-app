import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Relative base so the built index.html loads over file:// inside Electron.
  base: './',
  plugins: [react(), tailwindcss()],
  // Two pages: the Electron app (index.html) and the TV screen served at /tv on the Secondary port (tv.html).
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tv: fileURLToPath(new URL('./tv.html', import.meta.url)),
      },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true },
});
