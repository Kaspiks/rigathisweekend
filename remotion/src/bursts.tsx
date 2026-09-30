// Particle bursts for the press impact, behind one interface so they can be swapped and compared.
//
// Why these are hand-written rather than pulled from a template pack: every ready-made particle
// component is a FULL-FRAME SCENE (confetti over the whole canvas, fireworks in the middle). What the
// press needs is an EMITTER tied to a rectangle - the gap that closes between the plate and the cloth -
// firing on one frame. That is a different shape of thing, and adapting a scene to it is more work
// than writing the emitter. What a pack is genuinely worth reading is the motion: how a particle is
// weighted, how it fades. Port the feel, not the file.
//
// All of them take `t` in frames since the hit, so a negative t draws nothing and each burst owns its
// own lifetime. Positions come in as the plate rect, so a burst never hard-codes the press geometry.
import type { ReactElement } from 'react';

export const BURSTS = ['steam', 'flour', 'steamflour', 'embers', 'shock', 'none'] as const;
export type BurstKind = (typeof BURSTS)[number];
export type BurstProps = { t: number; x: number; y: number; w: number; h: number };

// Deterministic: the same seed has to give the same particles on every frame, or each frame renders a
// different burst and the result flickers rather than animates.
const rng = (seed: number) => {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
};

// Particles are seeded once in normalised space (which edge, how far along it) and mapped onto the
// plate rect at render time, so changing the press size never means reseeding.
type Edge = 'front' | 'left' | 'right';
const seedEdges = (n: number, seed: number, frontShare: number) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const edge: Edge = r() < frontShare ? 'front' : (r() < 0.5 ? 'left' : 'right');
    return { edge, u: r(), a: r(), b: r(), c: r(), d: r() };
  });
};
const place = (p: { edge: Edge; u: number }, x: number, y: number, w: number, h: number) =>
  p.edge === 'front'
    ? { px: x + 0.08 * w + p.u * 0.84 * w, py: y + h, ox: (p.u - 0.5) * 2, oy: 1 }
    : { px: p.edge === 'left' ? x : x + w, py: y + 0.34 * h + p.u * 0.62 * h, ox: p.edge === 'left' ? -1 : 1, oy: 0 };

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// ---- steam: a restrained heat puff that stays close to the press -------------------------------
const STEAM = seedEdges(58, 23, 0.74);
const Steam = ({ t, x, y, w, h }: BurstProps) => (
  <>
    {STEAM.map((p, i) => {
      // Only a few puffs linger; most dissipate close to the closing gap.
      const slow = p.c > 0.82;
      const delay = Math.pow(p.a, 2) * (slow ? 30 : 18), life = (slow ? 58 : 34) + p.b * 34;
      const k = (t - delay) / life;
      if (k <= 0 || k >= 1) return null;
      const ease = 1 - Math.pow(1 - k, 2.2);
      const { px, py, ox } = place(p, x, y, w, h);
      const size = (slow ? 150 : 86) + p.c * 120;
      const out = (slow ? 52 : 72) * (1 + p.d * 1.45) * ease;
      const rise = (slow ? 230 : 185) * (1 + p.c * 0.7) * k * k;
      return (
        <div key={i} style={{
          position: 'absolute', left: px - size / 2 + ox * out, top: py - size / 2 - rise,
          width: size, height: size,
          background: 'radial-gradient(circle at 50% 50%, rgba(255,253,248,0.42) 0%, rgba(252,246,232,0.2) 34%, rgba(250,244,230,0.06) 62%, transparent 76%)',
          transform: `scale(${lerp(0.25, slow ? 2.15 : 1.7, ease).toFixed(3)})`,
          opacity: Math.sin(Math.PI * k) * (slow ? 0.4 : 0.56),
        }} />
      );
    })}
  </>
);

// ---- flour: hard little grains thrown clear, then gravity takes them ---------------------------
// The one that actually suits a press hitting cloth. Steam says hot; flour says something was struck.
const FLOUR = seedEdges(96, 71, 0.72);
const Flour = ({ t, x, y, w, h }: BurstProps) => (
  <>
    {FLOUR.map((p, i) => {
      const delay = p.a * 5, life = 30 + p.b * 34;
      const k = (t - delay) / life;
      if (k <= 0 || k >= 1) return null;
      const { px, py, ox } = place(p, x, y, w, h);
      const speed = 120 + p.c * 420, up = 180 + p.d * 300;
      // Thrown out at a constant rate and pulled down at an accelerating one: a real ballistic arc,
      // which is what separates grains from the drifting blobs of a steam puff.
      const dx = ox * speed * k + (p.b - 0.5) * 90 * k;
      const dy = -up * k + 520 * k * k;
      const size = 3 + p.c * 9;
      return (
        <div key={i} style={{
          position: 'absolute', left: px + dx, top: py + dy, width: size, height: size,
          borderRadius: size, background: '#f6efdd',
          opacity: (1 - Math.pow(k, 2.4)) * 0.85,
        }} />
      );
    })}
  </>
);

// ---- embers: the plate is hot, so a few specks lift and flicker out ----------------------------
const EMBER = seedEdges(56, 97, 0.58);
const Embers = ({ t, x, y, w, h }: BurstProps) => (
  <>
    {EMBER.map((p, i) => {
      const delay = p.a * 22, life = 44 + p.b * 50;
      const k = (t - delay) / life;
      if (k <= 0 || k >= 1) return null;
      const { px, py, ox } = place(p, x, y, w, h);
      const rise = (260 + p.c * 520) * k;
      const drift = ox * (40 + p.d * 120) * k + Math.sin(k * 9 + p.a * 6) * (14 + p.b * 22);
      const size = 2 + p.c * 6;
      // Flicker rides on top of the fade, so specks wink rather than dim evenly.
      const flick = 0.55 + 0.45 * Math.sin(k * 30 + p.d * 7);
      return (
        <div key={i} style={{
          position: 'absolute', left: px + drift, top: py - rise, width: size, height: size,
          borderRadius: size, background: p.b > 0.6 ? '#ffd9a0' : '#ff9648',
          boxShadow: `0 0 ${size * 3}px rgba(255,150,70,0.8)`,
          opacity: Math.sin(Math.PI * k) * flick,
        }} />
      );
    })}
  </>
);

// ---- shock: one ring leaving the front edge, plus dust kept low to the cloth -------------------
const DUST = seedEdges(40, 131, 1);
const Shock = ({ t, x, y, w, h }: BurstProps) => {
  const k = t / 26;
  return (
    <>
      {k > 0 && k < 1 && (
        <div style={{
          position: 'absolute', left: x - w * 0.1, top: y + h - 70, width: w * 1.2, height: 140,
          borderRadius: '50%', border: `${lerp(9, 1, k).toFixed(1)}px solid rgba(255,250,238,0.75)`,
          transform: `scale(${lerp(0.25, 1.5, 1 - Math.pow(1 - k, 3)).toFixed(3)})`,
          opacity: 1 - k,
        }} />
      )}
      {DUST.map((p, i) => {
        const delay = p.a * 8, life = 34 + p.b * 30;
        const kk = (t - delay) / life;
        if (kk <= 0 || kk >= 1) return null;
        const ease = 1 - Math.pow(1 - kk, 2.6);
        const { px, py } = place(p, x, y, w, h);
        const side = p.u < 0.5 ? -1 : 1;
        const size = 40 + p.c * 120;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: px - size / 2 + side * (200 + p.d * 460) * ease,
            top: py - size / 2 - (20 + p.b * 90) * ease,
            width: size, height: size,
            background: 'radial-gradient(circle, rgba(252,246,232,0.36) 0%, rgba(250,244,230,0.1) 50%, transparent 72%)',
            transform: `scale(${lerp(0.4, 2, ease).toFixed(3)})`,
            opacity: (1 - kk) * 0.7,
          }} />
        );
      })}
    </>
  );
};

// A press hitting damp cloth throws grain AND steam, so the combination is the honest one.
const SteamFlour = (p: BurstProps) => (<><Flour {...p} /><Steam {...p} /></>);

const KINDS: Record<BurstKind, ((p: BurstProps) => ReactElement) | null> = {
  steam: Steam, flour: Flour, steamflour: SteamFlour, embers: Embers, shock: Shock, none: null,
};

export const Burst = ({ kind, ...rest }: BurstProps & { kind: BurstKind }) => {
  const C = KINDS[kind] || null;
  if (!C || rest.t < 0) return null;
  return <C {...rest} />;
};
