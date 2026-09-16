// Story animation: a photographed envelope opens and a blank card slides out, for text added later in Canva.
// Usage: node src/envelope.js <envelope.png> <outDir>   |   node src/envelope.js --layers <envelope.png> <outDir>
// The photo must be the envelope back with its flap closed, like the 1565×1005 source it was measured on;
// the flap and crease geometry below is in that photo's pixels.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { frameWriter, flatten } from './video.js';

const W = 1565, H = 1005, CX = W / 2;
const SW = 1080, SH = 1920, BG = [0x17, 0x35, 0x2d];
const EW = 900, S = EW / W, EL = 90, ET = 1080;
const BODY_H = Math.round(H * S);
const CARD = { w: 680, h: 1000, top: 360, r: 8, fill: '#f7f4ec' };
const CARD_LEFT = (SW - CARD.w) / 2;
const FLAP_H = 712, FLAP_OPEN_SQUASH = 0.9;

// Measured on the photo: crease lines from the bottom corners and the closed flap outline.
const creaseBottom = [19, 848], creaseSlope = -1.06, creaseAt = [185, 672];
const apexY = creaseAt[1] + creaseSlope * (CX - creaseAt[0]);
const flapPath = (() => {
  const l = x => 125 + 0.857 * (x - 80);
  const ctrl = 2 * 702 - l(730);
  const L = (x, y) => `${x},${y.toFixed(1)}`, R = (x, y) => `${W - x},${y.toFixed(1)}`;
  return `M4,0 Q14,10 ${L(22, 26)} L${L(46, 80)} Q58,108 ${L(80, l(80))} L${L(730, l(730))} Q${CX},${ctrl} ${R(730, l(730))} L${R(80, l(80))} Q${W - 58},108 ${R(46, 80)} L${R(22, 26)} Q${W - 14},10 ${W - 4},0 Z`;
})();
const pocketY = x => ET + apexY * S * (1 - Math.abs(x - SW / 2) / (EW / 2));

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const png = img => img.png().toBuffer();
const clearCanvas = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });

// Embossed paper grain lit from the top-left, matched to the photo's tone.
async function grain(src, w, h, contrast) {
  const layer = async (div, sigma) => {
    const n = await png(sharp({ create: { width: Math.ceil(w / div), height: Math.ceil(h / div), channels: 3, noise: { type: 'gaussian', mean: 128, sigma } } }).greyscale());
    return sharp(n).extractChannel(0).resize(w, h, { kernel: 'cubic' }).raw().toBuffer();
  };
  const [a, b, c] = await Promise.all([layer(5, 60), layer(2.2, 50), layer(1, 40)]);
  const hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hgt[i] = 0.5 * a[i] + 0.35 * b[i] + 0.15 * c[i];
  const g = new Float32Array(w * h); let mean = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - 2), y0 = Math.max(0, y - 2), x1 = Math.min(w - 1, x + 2), y1 = Math.min(h - 1, y + 2);
    const v = hgt[y0 * w + x0] - hgt[y1 * w + x1] + 0.25 * (hgt[y * w + x] - 128);
    g[y * w + x] = v; mean += v;
  }
  mean /= w * h;
  let sd = 0; for (const v of g) sd += (v - mean) ** 2; sd = Math.sqrt(sd / (w * h));
  const { data } = await sharp(src).extract({ left: 560, top: 760, width: 440, height: 230 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = data.length / 3, tone = [0, 0, 0]; let lumSd = 0;
  for (let i = 0; i < data.length; i++) tone[i % 3] += data[i] / n;
  const avg = (tone[0] + tone[1] + tone[2]) / 3;
  for (let i = 0; i < n; i++) { const l = (data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2]) / 3; lumSd += (l - avg) ** 2; }
  lumSd = Math.sqrt(lumSd / n);
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const d = (g[i] - mean) / sd * lumSd * contrast;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.max(0, Math.min(255, Math.round(tone[k] + d + 2)));
  }
  return png(sharp(out, { raw: { width: w, height: h, channels: 3 } }));
}

const crease = ([x1, y1], [x2, y2]) =>
  `<line x1="${x1}" y1="${y1 - 1.6}" x2="${x2}" y2="${y2 - 1.6}" stroke="rgba(0,0,0,0.085)" stroke-width="2.4"/>
   <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.85)" stroke-width="1.6"/>`;

// Everything that does not change between frames, at story scale.
export async function buildLayers(src) {
  const orig = await png(sharp(src).ensureAlpha());
  const meta = await sharp(orig).metadata();
  if (meta.width !== W || meta.height !== H) throw new Error(`Envelope photo must be ${W}×${H}, got ${meta.width}×${meta.height}`);

  // Body with the flap painted out and the creases continued up to the pocket edge.
  const tex = await png(sharp(await grain(orig, W, H, 0.8)).composite([{ input: svg(W, H, crease(creaseBottom, [CX, apexY]) + crease([W - creaseBottom[0], creaseBottom[1]], [CX, apexY])) }]).removeAlpha());
  const cover = await sharp(svg(W, H, `<rect width="${W}" height="${H}" fill="#000"/><path d="${flapPath}" fill="#fff" stroke="#fff" stroke-width="190" stroke-linejoin="round"/>`))
    .flatten().blur(16).extractChannel(0).raw().toBuffer();
  const patch = await png(sharp(tex).joinChannel(cover, { raw: { width: W, height: H, channels: 1 } }));
  const bodyFull = await png(sharp(orig).composite([
    { input: patch },
    { input: svg(W, H, `<path d="M0,0 L${CX},${apexY} L${W},0 Z" fill="#000"/><rect width="${W}" height="1" fill="#000"/>`), blend: 'dest-out' },
    { input: svg(W, H, `<polyline points="0,0.5 ${CX},${apexY + 0.5} ${W},0.5" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="2.2"/>
      <polyline points="0,3 ${CX},${apexY + 3} ${W},3" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.6"/>`), blend: 'atop' },
  ]));
  const body = await png(sharp(bodyFull).resize(EW));

  // Flap cut from the photo: outer face (closed) and flipped inner face (open).
  const flapMasked = await png(sharp(orig).composite([{ input: svg(W, H, `<path d="${flapPath}" fill="#fff"/>`), blend: 'dest-in' }]));
  const flapCut = await png(sharp(flapMasked).extract({ left: 0, top: 0, width: W, height: FLAP_H }));
  const flapOuter = await png(sharp(flapCut).resize(EW));
  const flapInnerFull = await png(sharp(await png(sharp(flapCut).flip())).composite([{
    input: svg(W, FLAP_H, `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.13"/><stop offset="0.35" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
      <rect width="${W}" height="${FLAP_H}" fill="url(#g)"/>
      <path d="${flapPath}" transform="translate(0,${FLAP_H}) scale(1,-1)" fill="none" stroke="rgba(0,0,0,0.10)" stroke-width="3"/>
      <rect y="${FLAP_H - 3}" width="${W}" height="3" fill="rgba(0,0,0,0.12)"/>`), blend: 'atop' }]));
  const flapInner = await png(sharp(flapInnerFull).resize(EW));
  // Soft contact shadow of the closed flap on the body, padded so the blur has room.
  const pad = 24;
  const flapShadow = await png(sharp(await png(clearCanvas(EW + pad * 2, Math.round(FLAP_H * S) + pad * 2)
    .composite([{ input: await png(sharp(flapCut).resize(EW).composite([{ input: svg(EW, Math.round(FLAP_H * S), `<rect width="${EW}" height="${Math.round(FLAP_H * S)}" fill="#000"/>`), blend: 'in' }])), left: pad, top: pad }]))).blur(5));

  const cardTex = await png(sharp(await grain(orig, CARD.w, CARD.h, 0.55)).modulate({ brightness: 1.07 }));
  const card = await png(sharp({ create: { width: CARD.w, height: CARD.h, channels: 4, background: CARD.fill } }).composite([
    { input: cardTex, blend: 'multiply' },
    { input: svg(CARD.w, CARD.h, `<rect width="${CARD.w}" height="${CARD.h}" rx="${CARD.r}" fill="#fff"/>`), blend: 'dest-in' },
    { input: svg(CARD.w, CARD.h, `<rect x="0.75" y="0.75" width="${CARD.w - 1.5}" height="${CARD.h - 1.5}" rx="${CARD.r}" fill="none" stroke="rgba(0,0,0,0.10)" stroke-width="1.5"/>`), blend: 'atop' },
  ]));
  const cardShadowPad = 60;
  const cardShadow = await png(sharp(await png(clearCanvas(CARD.w + cardShadowPad * 2, CARD.h + cardShadowPad * 2)
    .composite([{ input: svg(CARD.w + cardShadowPad * 2, CARD.h + cardShadowPad * 2, `<rect x="${cardShadowPad + 8}" y="${cardShadowPad + 18}" width="${CARD.w - 6}" height="${CARD.h}" rx="10" fill="rgba(0,0,0,0.38)"/>`) }]))).blur(20));

  const bodyShadow = await png(sharp(await png(clearCanvas(SW, SH).composite([{ input: svg(SW, SH, `<rect x="${EL + 10}" y="${ET + 26}" width="${EW - 20}" height="${BODY_H - 10}" fill="rgba(0,0,0,0.55)"/>`) }]))).blur(28));
  const inside = svg(SW, SH, `<polygon points="${EL},${ET} ${SW / 2},${pocketY(SW / 2)} ${EL + EW},${ET}" fill="#cfcac0"/>`);
  return { body, flapOuter, flapInner, flapShadow, pad, card, cardShadow, cardShadowPad, bodyShadow, inside, full: { body: bodyFull, flapOuter: flapCut, flapInner: flapInnerFull } };
}

const clamp01 = x => Math.max(0, Math.min(1, x));
const easeInOut = x => x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
const easeOutQuart = x => 1 - (1 - x) ** 4;
const lerp = (a, b, t) => a + (b - a) * t;

// Timeline in seconds.
export const TIMING = { duration: 5.5, flap: [0.5, 1.9], card: [1.75, 4.3] };
export function stateAt(t) {
  const fp = clamp01((t - TIMING.flap[0]) / (TIMING.flap[1] - TIMING.flap[0]));
  const cp = clamp01((t - TIMING.card[0]) / (TIMING.card[1] - TIMING.card[0]));
  // The card eases in gently, then decelerates into place.
  const cardEase = cp < 0.25 ? easeInOut(cp / 0.25) * 0.12 : 0.12 + easeOutQuart((cp - 0.25) / 0.75) * 0.88;
  return { angle: Math.PI * easeInOut(fp), cardTop: Math.round(lerp(ET + 30, CARD.top, cardEase)) };
}

export async function renderFrame(L, { angle, cardTop }) {
  const layers = [{ input: L.bodyShadow }];
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const widen = 1 + 0.05 * sin; // the flap tip swings toward the camera
  const flapW = Math.round(EW * widen), flapLeft = Math.round(EL - (flapW - EW) / 2);
  if (cos > 0) {
    // Closed half: outer face folds down over the body.
    layers.push({ input: L.inside });
    layers.push({ input: L.body, left: EL, top: ET });
    const h = Math.max(1, Math.round(FLAP_H * S * cos));
    const shade = svg(flapW, h, `<rect width="${flapW}" height="${h}" fill="rgba(0,0,0,${(0.10 * sin).toFixed(3)})"/>`);
    const flap = await png(sharp(L.flapOuter).resize(flapW, h, { fit: 'fill' }).composite([{ input: shade, blend: 'atop' }]));
    const shH = Math.max(1, Math.round((FLAP_H * S + L.pad * 2) * cos)), shW = Math.round((EW + L.pad * 2) * widen);
    const alpha = (0.28 * (1 - 0.6 * sin)).toFixed(3);
    const shadow = await png(sharp(await png(sharp(L.flapShadow).resize(shW, shH, { fit: 'fill' }))).composite([{ input: svg(shW, shH, `<rect width="${shW}" height="${shH}" fill="rgba(0,0,0,${alpha})"/>`), blend: 'dest-in' }]));
    layers.push({ input: shadow, left: Math.round(EL - (shW - EW) / 2), top: Math.round(ET - L.pad * cos + 4 + 10 * sin) });
    layers.push({ input: flap, left: flapLeft, top: ET });
  } else {
    // Open half: inner face stands up behind the card.
    const h = Math.max(1, Math.round(FLAP_H * S * FLAP_OPEN_SQUASH * -cos));
    layers.push({ input: await png(sharp(L.flapInner).resize(flapW, h, { fit: 'fill' })), left: flapLeft, top: ET - h });
    layers.push({ input: L.inside });
    const visible = Math.min(CARD.h, ET + BODY_H - 30 - cardTop);
    if (visible > 0 && cardTop < pocketY(CARD_LEFT)) {
      const shVisible = Math.min(CARD.h + L.cardShadowPad * 2, ET + BODY_H - 30 - (cardTop - L.cardShadowPad));
      layers.push({ input: await png(sharp(L.cardShadow).extract({ left: 0, top: 0, width: CARD.w + L.cardShadowPad * 2, height: shVisible })), left: CARD_LEFT - L.cardShadowPad, top: cardTop - L.cardShadowPad });
      layers.push({ input: await png(sharp(L.card).extract({ left: 0, top: 0, width: CARD.w, height: visible })), left: CARD_LEFT, top: cardTop });
      // Inside the pocket the card is in shade; only where the card actually is.
      const bandTop = ET - 130, bandH = Math.ceil(pocketY(SW / 2) - bandTop + 2), from = Math.max(0, cardTop - bandTop);
      if (from < bandH) layers.push({ input: svg(CARD.w, bandH, `<defs><linearGradient id="a" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${bandH}"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.6" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.15"/></linearGradient></defs>
        <rect y="${from}" width="${CARD.w}" height="${bandH - from}" fill="url(#a)"/>`), left: CARD_LEFT, top: bandTop });
    }
    layers.push({ input: L.body, left: EL, top: ET });
  }
  return clearCanvas(SW, SH).composite(layers).raw().toBuffer();
}

export async function renderEnvelope(src, outDir, { fps = 30, name = 'envelope-open' } = {}) {
  await mkdir(outDir, { recursive: true });
  const L = await buildLayers(src);
  const size = { width: SW, height: SH, fps };
  const writers = {
    mp4: frameWriter({ ...size, out: join(outDir, `${name}.mp4`), preset: 'mp4' }),
    webm: frameWriter({ ...size, out: join(outDir, `${name}-transparent.webm`), preset: 'webm' }),
    prores: frameWriter({ ...size, out: join(outDir, `${name}-transparent.mov`), preset: 'prores' }),
  };
  const frames = Math.round(TIMING.duration * fps);
  for (let i = 0; i < frames; i++) {
    const rgba = await renderFrame(L, stateAt(i / fps));
    await Promise.all([writers.mp4.write(flatten(rgba, BG)), writers.webm.write(rgba), writers.prores.write(rgba)]);
    if (i === frames - 1) await sharp(flatten(rgba, BG), { raw: { width: SW, height: SH, channels: 4 } }).removeAlpha().jpeg({ quality: 92 }).toFile(join(outDir, `${name}-last-frame.jpg`));
  }
  return Promise.all(Object.values(writers).map(w => w.end()));
}

// Full-resolution envelope pieces for compositing elsewhere (the Remotion story). Geometry is returned in
// source pixels so the consumer can scale freely: the flap hinges on the body's top edge.
export async function exportLayers(src, outDir) {
  await mkdir(outDir, { recursive: true });
  const { full } = await buildLayers(src);
  await Promise.all([
    sharp(full.body).toFile(join(outDir, 'body.png')),
    sharp(full.flapOuter).toFile(join(outDir, 'flap-outer.png')),
    sharp(full.flapInner).toFile(join(outDir, 'flap-inner.png')),
  ]);
  return { width: W, height: H, flapHeight: FLAP_H, pocketDepth: +apexY.toFixed(1), creaseApex: [CX, +apexY.toFixed(1)] };
}

if (import.meta.main) {
  if (process.argv[2] === '--layers') {
    const [, src, outDir = '.'] = process.argv.slice(2);
    console.log(JSON.stringify(await exportLayers(src, outDir)));
    process.exit(0);
  }
  const [src, outDir = '.'] = process.argv.slice(2);
  if (!src) { console.error('Usage: node src/envelope.js <envelope.png> [outDir]'); process.exit(1); }
  console.log((await renderEnvelope(src, outDir)).join('\n'));
}
