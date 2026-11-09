// Large PNG hero images are turned into JPEGs before upload (lib/shrinkImage.js).

import { PNG } from 'pngjs';
import { shrinkImage, isPng, withExt } from '../netlify/functions/lib/shrinkImage.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const ok = (c, m) => { if (!c) throw new Error(m); };

// A noisy 1024x576 photo-like PNG (noise keeps the PNG large).
function bigPng(alpha = 255) {
  const png = new PNG({ width: 1024, height: 576 });
  let s = 7;
  for (let i = 0; i < png.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    png.data[i] = s & 255; png.data[i + 1] = (s >> 8) & 255; png.data[i + 2] = (s >> 16) & 255; png.data[i + 3] = alpha;
  }
  return PNG.sync.write(png);
}

t('a large PNG becomes a smaller JPEG', () => {
  const src = bigPng();
  ok(src.length > 400 * 1024, 'fixture too small: ' + src.length);
  const out = shrinkImage(src);
  ok(out.shrunk && out.mime === 'image/jpeg' && out.ext === 'jpg', JSON.stringify({ ...out, buffer: undefined }));
  ok(out.buffer.length < src.length, 'not smaller');
  ok(out.buffer[0] === 0xff && out.buffer[1] === 0xd8, 'not a JPEG');
});

t('transparent pixels are flattened, not broken', () => {
  const out = shrinkImage(bigPng(128));
  ok(out.shrunk && out.mime === 'image/jpeg', 'not converted');
});

t('small PNGs and non-PNGs are left alone', () => {
  const small = PNG.sync.write(new PNG({ width: 8, height: 8 }));
  const a = shrinkImage(small);
  ok(!a.shrunk && a.buffer === small && a.mime === 'image/png', 'small png changed');
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
  const b = shrinkImage(jpg);
  ok(!b.shrunk && b.buffer === jpg && b.mime === 'image/jpeg', 'jpeg changed');
});

t('a corrupt PNG is passed through instead of throwing', () => {
  const bad = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500 * 1024, 7)]);
  const out = shrinkImage(bad);
  ok(!out.shrunk && out.buffer === bad && isPng(out.buffer), 'changed');
});

t('filenames follow the format', () => {
  ok(withExt('hero-title.png', 'jpg') === 'hero-title.jpg', withExt('hero-title.png', 'jpg'));
  ok(withExt('hero', 'png') === 'hero.png', 'no ext');
});

console.log(`\nshrinkImage: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
