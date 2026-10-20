// Depth pictures are served by the render service on its own port, and Chrome will not use a picture
// from another origin inside an SVG filter (feImage), even with CORS. So each one is fetched once and
// turned into a blob: URL, which counts as the page's own. Remotion waits until it is decoded.
import { useEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';

const ready = new Map<string, string>();
const pixels = new Map<string, ImageData>();

// The brightest (0–1) of the depth picture in a small patch around a point given in 0–1 of the footage:
// for the ground under something's feet, the nearest part of it. Null until the picture has loaded.
export function depthNear(url: string | null, x: number, y: number, near: 'white' | 'black' | undefined): number | null {
  const img = url ? pixels.get(url) : undefined;
  if (!img) return null;
  const cx = Math.round(x * (img.width - 1)), cy = Math.round(y * (img.height - 1));
  let best = -1;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) {
    const px = cx + dx, py = cy + dy;
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
    const g = img.data[(py * img.width + px) * 4] / 255, v = near === 'black' ? 1 - g : g;
    if (v > best) best = v;
  }
  return best < 0 ? null : best;
}

export function useLocalImage(url: string | null): string | null {
  const [, redraw] = useState(0);
  const waiting = useRef<{ url: string; handle: number } | null>(null);
  if (url && !ready.has(url) && waiting.current?.url !== url) {
    const handle = delayRender(`Loading depth picture ${url}`);
    waiting.current = { url, handle };
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`Depth picture ${url}: HTTP ${r.status}`); return r.blob(); })
      .then(async (blob) => {
        const local = URL.createObjectURL(blob);
        const img = new Image();
        img.src = local;
        await img.decode();
        // The pixels too, so a layer can read the depth under its feet (depth "auto").
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        pixels.set(url, ctx.getImageData(0, 0, canvas.width, canvas.height));
        ready.set(url, local);
        redraw((n) => n + 1);
      })
      .catch((err) => cancelRender(err));
  }
  const local = url ? ready.get(url) ?? null : null;
  // Only let Remotion take the frame once the picture is in the page.
  useEffect(() => {
    if (local && waiting.current?.url === url) { continueRender(waiting.current.handle); waiting.current = null; }
  }, [local, url]);
  return local;
}
