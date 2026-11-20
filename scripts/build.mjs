// Bundles the renderer (three.js + SmartSpectra renderer SDK) into dist/renderer.bundle.js.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'src/renderer/app.js')],
  bundle: true,
  outfile: path.join(root, 'dist/renderer.bundle.js'),
  platform: 'browser',
  format: 'iife',
  logLevel: 'warning',
  sourcemap: false,
});
console.log('renderer bundled');
