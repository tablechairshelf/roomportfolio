// Generates optimized artwork images from the originals in public/images/Artwork.
//   thumbs/  - small images for the gallery grid
//   large/   - screen-sized images for the full-view lightbox
// Run with: npm run optimize-art  (re-run after adding new artwork)
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC_DIR = path.resolve('public/images/Artwork');
const OUTPUTS = [
  { dir: 'thumbs', width: 480, quality: 75 },
  { dir: 'large', width: 2048, quality: 82 },
];

const files = (await readdir(SRC_DIR, { withFileTypes: true }))
  .filter((f) => f.isFile() && /\.(jpe?g|png)$/i.test(f.name))
  .map((f) => f.name);

for (const out of OUTPUTS) await mkdir(path.join(SRC_DIR, out.dir), { recursive: true });

for (const name of files) {
  const base = name.replace(/\.[^/.]+$/, '');
  for (const out of OUTPUTS) {
    await sharp(path.join(SRC_DIR, name))
      .rotate() // apply EXIF orientation
      .resize({ width: out.width, height: out.width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: out.quality })
      .toFile(path.join(SRC_DIR, out.dir, `${base}.webp`));
  }
  console.log(`optimized ${name}`);
}
