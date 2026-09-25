// Depth pictures are served by the render service on its own port, and Chrome will not use a picture
// from another origin inside an SVG filter (feImage), even with CORS. So each one is fetched once and
// turned into a blob: URL, which counts as the page's own. Remotion waits until it is decoded.
import { useEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';

const ready = new Map<string, string>();

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
