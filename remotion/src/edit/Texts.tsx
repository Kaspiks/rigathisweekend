// Words over footage, in the brand's type: a serif headline, a caption strip, a callout card with a line
// to what it names, a small tag, a handwritten accent, or a full-width band.
import type { CSSProperties, ReactNode } from 'react';
import { Easing, random } from 'remotion';
import type { Point, TextLayer } from './model';
import { PALETTE, blendMode, colour, lerp, motionStyle, phase } from './model';
import type { TextMotion } from './model';

export const DEFAULT_AT: Record<TextLayer['style'], Point> = {
  title: { x: 0.5, y: 0.16 }, caption: { x: 0.5, y: 0.72 }, band: { x: 0.5, y: 0.1 }, callout: { x: 0.5, y: 0.5 }, label: { x: 0.5, y: 0.5 }, script: { x: 0.5, y: 0.5 },
};
const SIZE: Record<TextLayer['style'], number> = { title: 112, caption: 60, callout: 54, label: 36, script: 120, band: 50 };
const serif = '"Cormorant Garamond", Georgia, serif';

function look(layer: TextLayer, size: number): CSSProperties {
  const bg = layer.background === 'none' ? 'transparent' : undefined;
  switch (layer.style) {
    case 'title':
      return { fontFamily: serif, fontWeight: 700, fontSize: size, lineHeight: 1.02, color: colour(layer.color, PALETTE.paper), background: bg ?? colour(layer.background, 'transparent'), textShadow: '0 1px 2px rgba(0,0,0,0.7), 0 3px 10px rgba(0,0,0,0.6), 0 10px 44px rgba(0,0,0,0.55)', letterSpacing: '0.01em' };
    case 'caption':
      return { fontFamily: serif, fontWeight: 700, fontSize: size, lineHeight: 1.12, color: colour(layer.color, PALETTE.ink), background: bg ?? colour(layer.background, PALETTE.paper), padding: '0.2em 0.55em 0.26em', borderRadius: size * 0.3, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' };
    case 'callout':
      return { fontFamily: serif, fontWeight: 700, fontSize: size, lineHeight: 1.08, color: colour(layer.color, PALETTE.ink), background: bg ?? colour(layer.background, PALETTE.paper), padding: '0.4em 0.6em 0.46em', borderRadius: 22, borderLeft: `10px solid ${PALETTE.lime}`, boxShadow: '0 18px 44px rgba(0,0,0,0.38)' };
    case 'label':
      return { fontFamily: serif, fontWeight: 700, fontSize: size, lineHeight: 1, color: colour(layer.color, PALETTE.ink), background: bg ?? colour(layer.background, PALETTE.lime), padding: '0.36em 0.7em 0.42em', borderRadius: 999, letterSpacing: '0.14em', textTransform: 'uppercase', boxShadow: '0 6px 18px rgba(0,0,0,0.3)' };
    case 'script':
      return { fontFamily: '"Great Vibes", cursive', fontSize: size, lineHeight: 1.1, color: colour(layer.color, PALETTE.lime), background: bg ?? colour(layer.background, 'transparent'), textShadow: '0 4px 18px rgba(0,0,0,0.6)', padding: '0 0.2em' };
    case 'band':
    default:
      return { fontFamily: serif, fontWeight: 700, fontSize: size, lineHeight: 1, color: colour(layer.color, PALETTE.paper), background: bg ?? colour(layer.background, PALETTE.ink), borderTop: `5px solid ${PALETTE.lime}`, padding: '0.55em 0.8em', letterSpacing: '0.18em', textTransform: 'uppercase' };
  }
}

// Typefaces: the brand's serif and script, plus a heavy sans, tall display capitals and a typewriter mono.
const FONTS: Record<NonNullable<TextLayer['font']>, { family: string; weight: number }> = {
  serif: { family: serif, weight: 700 }, script: { family: '"Great Vibes", cursive', weight: 400 },
  sans: { family: '"Inter", system-ui, sans-serif', weight: 800 }, display: { family: '"Bebas Neue", Impact, sans-serif', weight: 400 },
  mono: { family: '"JetBrains Mono", ui-monospace, monospace', weight: 700 },
};
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?';
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const out = Easing.out(Easing.cubic), spring = Easing.out(Easing.back(1.7));
const plain = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// How one piece (a letter, word or line) looks at progress p of its entrance (0 hidden → 1 in place).
function pieceLook(style: TextMotion['style'], p: number): CSSProperties {
  const e = out(p);
  switch (style) {
    case 'fade': return { opacity: p };
    case 'rise': return { opacity: clamp(p * 2), transform: `translateY(${((1 - e) * 0.55).toFixed(3)}em)` };
    case 'drop': return { opacity: clamp(p * 3), transform: `translateY(${(-(1 - spring(p)) * 0.7).toFixed(3)}em)` };
    case 'pop': return { opacity: p > 0 ? 1 : 0, transform: `scale(${Math.max(0, spring(p)).toFixed(3)})`, transformOrigin: '50% 80%' };
    case 'blur': return { opacity: p, filter: p < 1 ? `blur(${((1 - p) * 10).toFixed(2)}px)` : undefined };
    case 'slide': return { opacity: p, transform: `translateX(${(-(1 - e) * 0.8).toFixed(3)}em)` };
    case 'flip': return { opacity: p > 0 ? 1 : 0, transform: `perspective(400px) rotateX(${((1 - e) * 90).toFixed(1)}deg)`, transformOrigin: '50% 100%' };
    case 'typewriter': case 'scramble': return { visibility: p > 0 ? 'visible' : 'hidden' };
    default: return {};
  }
}

type Unit = { text: string; letter: number; word: number; line: number };

export const TextBox = ({ layer, x, y, anchor, frame, width }: { layer: TextLayer; x: number; y: number; anchor: Point | null; frame: number; width: number }) => {
  const p = phase(layer, frame);
  if (!p.on) return null;
  const f = p.local;
  // The old typewriter entrance is a letter-by-letter reveal spread over the entrance.
  const n0 = Math.max(1, [...layer.text].length);
  const reveal = layer.reveal ?? (layer.enter === 'type' ? { by: 'letter', style: 'typewriter', stagger: layer.in / n0, duration: 1 } as TextMotion : undefined);
  const byPieces = !!(reveal || layer.hide);
  const m = motionStyle(byPieces ? 'fade' : layer.enter, layer.hide ? 'none' : layer.exit, byPieces ? Math.min(1, p.enter * 4) : p.enter, p.exit);
  const size = layer.size ?? SIZE[layer.style];
  const band = layer.style === 'band';

  // The words shown: a counting number goes where {n} is, or is the whole text.
  let text = layer.text;
  if (layer.count) {
    const v = lerp(layer.count.from, layer.count.to, out(clamp(f / layer.count.frames)));
    const shown = v.toLocaleString('en-US', { minimumFractionDigits: layer.count.decimals, maximumFractionDigits: layer.count.decimals });
    text = text.includes('{n}') ? text.replace('{n}', shown) : shown;
  }

  // Split into lines, words and letters, numbering each so pieces can be staggered.
  const lines = text.split('\n').map((line) => line.split(/(\s+)/));
  let letterNo = 0, wordNo = 0;
  const counts = { letter: 0, word: 0, line: lines.length };
  const tree = lines.map((parts, li) => parts.map((part) => {
    if (/^\s+$/.test(part) || !part) return { space: part };
    const letters: Unit[] = [...part].map((c) => ({ text: c, letter: letterNo++, word: wordNo, line: li }));
    return { word: wordNo++, raw: part, letters };
  }));
  counts.letter = letterNo; counts.word = wordNo;
  const progress = (unit: Unit, motion: TextMotion | undefined, hiding: boolean) => {
    if (!motion) return 1;
    const i = unit[motion.by], total = counts[motion.by];
    if (!hiding) return clamp((f - i * motion.stagger) / motion.duration);
    const start = p.length - ((total - 1) * motion.stagger + motion.duration);
    return 1 - clamp((f - start - i * motion.stagger) / motion.duration);
  };
  // A piece moves only with the motion set to its own level (letter, word or line); scrambling is judged
  // per letter against whichever level the scramble runs at.
  const looks = (unit: Unit, level: TextMotion['by']): CSSProperties => {
    const a = reveal?.by === level ? pieceLook(reveal.style, progress(unit, reveal, false)) : {};
    const b = layer.hide?.by === level ? pieceLook(layer.hide.style, progress(unit, layer.hide, true)) : {};
    return { ...a, ...b, transform: [a.transform, b.transform].filter(Boolean).join(' ') || undefined, opacity: ((a.opacity as number) ?? 1) * ((b.opacity as number) ?? 1) };
  };
  const scrambling = (u: Unit) => (reveal?.style === 'scramble' && progress(u, reveal, false) < 1) || (layer.hide?.style === 'scramble' && progress(u, layer.hide, true) < 1);
  const wave = layer.loop === 'wave' || layer.loop === 'bounce';
  const marks = new Set((layer.highlight?.words ?? []).map(plain));
  const hp = layer.highlight ? out(clamp((f - layer.highlight.delay) / 12)) : 0;
  const hl = layer.highlight;
  const markStyle = (): CSSProperties => {
    if (!hl) return {};
    const c = colour(hl.color, PALETTE.lime);
    if (hl.style === 'box') return { boxShadow: `inset 0 0 0 0.06em ${c}`, opacity: 1, padding: '0 0.1em', borderRadius: '0.08em', ...(hp < 1 ? { boxShadow: `inset 0 0 0 ${(0.06 * hp).toFixed(3)}em ${c}` } : {}) };
    return { backgroundImage: `linear-gradient(${c}, ${c})`, backgroundRepeat: 'no-repeat', backgroundSize: `${(hp * 100).toFixed(1)}% ${hl.style === 'underline' ? '0.1em' : '0.42em'}`,
      backgroundPosition: hl.style === 'underline' ? '0 92%' : '0 82%', padding: '0 0.08em', margin: '0 -0.08em' };
  };
  const letterFill: CSSProperties = layer.gradient
    ? { backgroundImage: `linear-gradient(to bottom, ${colour(layer.gradient[0], PALETTE.paper)}, ${colour(layer.gradient[1], PALETTE.lime)})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : {};
  const content: ReactNode = tree.map((parts, li) => (
    <span key={li} style={{ display: 'block' }}>
      {parts.map((part, pi) => {
        if ('space' in part) return part.space ? <span key={pi}>{part.space}</span> : null;
        const word = part as { word: number; raw: string; letters: Unit[] };
        const wordUnit: Unit = { text: word.raw, letter: word.letters[0].letter, word: word.word, line: li };
        const perLetter = reveal?.by === 'letter' || layer.hide?.by === 'letter' || wave || reveal?.style === 'scramble' || layer.hide?.style === 'scramble' || !!layer.gradient;
        const letters = perLetter ? word.letters.map((u) => {
          const own = looks(u, 'letter');
          const bob = wave ? (layer.loop === 'wave' ? Math.sin(frame * 0.25 - u.letter * 0.55) * 0.12 : -Math.abs(Math.sin(frame * 0.2 - u.letter * 0.4)) * 0.18) : 0;
          const ch = scrambling(u) && u.text.trim() ? GLYPHS[Math.floor(random(`scr-${layer.from}-${u.letter}-${Math.floor(frame / 2)}`) * GLYPHS.length)] : u.text;
          const style: CSSProperties = { display: 'inline-block', whiteSpace: 'pre', ...letterFill, ...own,
            transform: [own.transform, bob ? `translateY(${bob.toFixed(3)}em)` : ''].filter(Boolean).join(' ') || undefined };
          return <span key={u.letter} style={style}>{ch}</span>;
        }) : word.raw;
        return (
          <span key={pi} style={{ display: 'inline-block', whiteSpace: 'nowrap', ...(marks.has(plain(word.raw)) ? markStyle() : {}), ...looks(wordUnit, 'word') }}>{letters}</span>
        );
      })}
    </span>
  ));
  // Line-by-line motion moves each whole line.
  const lined = reveal?.by === 'line' || layer.hide?.by === 'line';
  const body = lined ? tree.map((parts, li) => {
    const unit: Unit = { text: '', letter: 0, word: 0, line: li };
    return <span key={li} style={{ display: 'block', ...looks(unit, 'line') }}>{(content as ReactNode[])[li]}</span>;
  }) : content;

  const base = look(layer, size);
  const font = layer.font ? FONTS[layer.font] : null;
  const glowColour = layer.glow ? colour(layer.glow, PALETTE.lime) : null;
  const pulse = layer.loop === 'glow' ? 0.6 + 0.4 * Math.sin(frame * 0.18) : 1;
  const glow = glowColour ? `0 0 ${8 * pulse}px ${glowColour}, 0 0 ${24 * pulse}px ${glowColour}, 0 0 ${48 * pulse}px ${glowColour}` : null;
  const shake = layer.loop === 'shake' ? `translate(${((random(`shx-${frame}`) - 0.5) * 6).toFixed(1)}px, ${((random(`shy-${frame}`) - 0.5) * 6).toFixed(1)}px)` : '';
  const breathe = layer.loop === 'pulse' ? ` scale(${(1 + Math.sin(frame * 0.2) * 0.04).toFixed(4)})` : '';
  const flicker = layer.loop === 'flicker' ? (random(`fl-${Math.floor(frame / 2)}`) < 0.12 ? 0.35 : 1) : 1;
  const box: CSSProperties = {
    position: 'absolute', left: band ? 0 : x, top: y, width: band ? width : 'max-content', maxWidth: band ? undefined : width * 0.84,
    transform: `translate(${band ? '0' : '-50%'}, -50%) translate(${m.dx}px, ${m.dy}px) scale(${m.scale})${breathe} rotate(${layer.rotate ?? 0}deg) ${shake}`,
    opacity: m.opacity * flicker, textAlign: layer.align, whiteSpace: 'pre-wrap', boxSizing: 'border-box', ...base,
    ...(font ? { fontFamily: font.family, fontWeight: font.weight } : {}),
    ...(layer.tracking != null ? { letterSpacing: `${layer.tracking}em` } : {}),
    ...(layer.count ? { fontVariantNumeric: 'tabular-nums' } : {}), // digits the same width, so a count does not jitter
    ...(layer.stroke ? { WebkitTextStroke: `${layer.stroke.width}px ${colour(layer.stroke.color, PALETTE.ink)}`, paintOrder: 'stroke fill' } : {}),
    // Clipped gradient letters would show a text shadow through them, so their shadow is drawn around the box instead.
    ...(layer.gradient ? { textShadow: 'none', filter: glow ? `drop-shadow(0 0 ${12 * pulse}px ${glowColour})` : 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))' } : glow ? { textShadow: glow } : {}),
    mixBlendMode: blendMode(layer.blend),
  };
  // The pointer grows out of the text towards the thing it names, ending in a dot on it.
  const pointer = layer.pointer && anchor ? (() => {
    const t = Easing.out(Easing.cubic)(p.enter);
    const ex = lerp(x, anchor.x, t), ey = lerp(y, anchor.y, t);
    return (
      <svg style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: m.opacity }} width="100%" height="100%">
        <line x1={x} y1={y} x2={ex} y2={ey} stroke={PALETTE.ink} strokeWidth={11} strokeLinecap="round" />
        <line x1={x} y1={y} x2={ex} y2={ey} stroke={PALETTE.lime} strokeWidth={5} strokeLinecap="round" />
        <circle cx={ex} cy={ey} r={12 * t} fill={PALETTE.paper} stroke={PALETTE.ink} strokeWidth={5} />
      </svg>
    );
  })() : null;
  return <>{pointer}<div style={box}>{body}</div></>;
};
