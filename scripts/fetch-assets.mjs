// Downloads CC0 textures from Poly Haven (https://polyhaven.com, CC0) into assets/textures.
// Usage: pnpm assets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets', 'textures');
fs.mkdirSync(out, { recursive: true });
const IDS = ['dark_planks', 'decrepit_wallpaper', 'rough_pine_door', 'grey_plaster'];
const MAPS = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };
const manifest = [];
for (const id of IDS) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  for (const [key, short] of Object.entries(MAPS)) {
    const f = files[key]?.['1k']?.jpg;
    if (!f) { console.warn('missing', id, key); continue; }
    const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
    fs.writeFileSync(path.join(out, `${id}_${short}.jpg`), buf);
    console.log('ok', id, short, buf.length);
  }
  manifest.push({ id, name: info.name, authors: Object.keys(info.authors || {}), license: 'CC0', url: `https://polyhaven.com/a/${id}` });
}
fs.writeFileSync(path.join(out, 'SOURCES.json'), JSON.stringify(manifest, null, 2));
