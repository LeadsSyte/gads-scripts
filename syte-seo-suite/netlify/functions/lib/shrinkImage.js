// Turn a large PNG hero image into a JPEG before it is uploaded to a CMS.
//
// Why: Google's image model returns ~2 MB PNGs, and some client sites cap
// uploads lower than that (The Bed Shop answered 413 to every hero image in
// Nov 2026). A JPEG of the same photo-style image is roughly a tenth of the
// size and looks the same on a blog. Pure JS (pngjs + jpeg-js) so it runs in
// any Netlify function without native binaries.
//
// shrinkImage(buffer) → { buffer, mime, ext }. Anything that is not a PNG, or
// is already small, comes back unchanged; a PNG that cannot be decoded also
// comes back unchanged so an upload is never blocked by this step.

import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

export const SHRINK_OVER_BYTES = 400 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

export const isPng = buf => !!buf && buf.length > 8 && PNG_SIG.every((b, i) => buf[i] === b);

export function shrinkImage(buffer, { quality = 82, overBytes = SHRINK_OVER_BYTES } = {}) {
  if (!isPng(buffer) || buffer.length <= overBytes) {
    return { buffer, mime: isPng(buffer) ? 'image/png' : 'image/jpeg', ext: isPng(buffer) ? 'png' : 'jpg', shrunk: false };
  }
  try {
    const png = PNG.sync.read(buffer);
    // JPEG has no transparency: flatten onto white.
    const data = png.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 1) {
        data[i] = Math.round(data[i] * a + 255 * (1 - a));
        data[i + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
        data[i + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
        data[i + 3] = 255;
      }
    }
    const out = jpeg.encode({ data, width: png.width, height: png.height }, quality).data;
    if (out.length >= buffer.length) return { buffer, mime: 'image/png', ext: 'png', shrunk: false };
    return { buffer: Buffer.from(out), mime: 'image/jpeg', ext: 'jpg', shrunk: true };
  } catch {
    return { buffer, mime: 'image/png', ext: 'png', shrunk: false };
  }
}

// Swap a filename's extension to match the (possibly converted) image.
export const withExt = (name, ext) => String(name || 'image').replace(/\.(png|jpe?g|webp|gif)$/i, '') + '.' + ext;
