import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// After a build, give the service worker the list of this build's files (so the whole app is
// stored on first visit and opens offline) and a cache name that changes with every deploy.
function precacheServiceWorker() {
  return {
    name: 'precache-service-worker',
    apply: 'build',
    writeBundle(options, bundle) {
      const out = options.dir ? path.resolve(options.dir) : path.resolve('dist');
      const swPath = path.join(out, 'sw.js');
      if (!fs.existsSync(swPath)) return;

      const bundled = Object.keys(bundle).filter((f) => f.startsWith('assets/'));
      const fontsDir = path.join(out, 'fonts');
      const fonts = fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir).map((f) => `fonts/${f}`) : [];
      const files = [...bundled, ...fonts].sort();
      const version = crypto.createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);

      const sw = fs
        .readFileSync(swPath, 'utf8')
        .replace('/*__PRECACHE__*/[]', JSON.stringify(files))
        .replace('__BUILD__', version);
      fs.writeFileSync(swPath, sw);
    },
  };
}

// Relative base so the build works from a GitHub Pages sub-path (/<repo>/).
// Two pages: the app itself, and the public stock board (stock/), which needs no sign-in.
export default defineConfig({
  base: './',
  plugins: [react(), precacheServiceWorker()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        stock: fileURLToPath(new URL('./stock/index.html', import.meta.url)),
      },
    },
  },
});
