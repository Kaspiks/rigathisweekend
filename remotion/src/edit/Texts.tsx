// Words over footage, in the brand's type: a serif headline, a caption strip, a callout card with a line
// to what it names, a small tag, a handwritten accent, or a full-width band.
import type { CSSProperties } from 'react';
import { Easing } from 'remotion';
import type { Point, TextLayer } from './model';
import { PALETTE, colour, lerp, motionStyle, phase } from './model';

export const DEFAULT_AT: Record<TextLayer['style'], Point> = {
  title: { x: 0.5, y: 0.16 }, caption: { x: 0.5, y: 0.72 }, band: { x: 0.5, y: 0.1 }, callout: { x: 0.5, y: 0.5 }, label: { x: 0.5, y: 0.5 }, script: { x: 0.5, y: 0.5 },
};
const SIZE: Record<TextLayer['style'], number> = { title: 112, caption: 60, callout: 54, label: 36, script: 120, band: 50 };
const serif = '"Cormorant Garamond", Georgia, serif';

function look(layer: TextLayer, size: number): CSSProperties {
  const bg = layer.background === 'none' ? 'transparent' : undefined;
  switch (layer.style) {
    case 'title':
      return { fontFamily: serif, fontWeight: 700, fontSize: size, lineHeight: 1.02, color: colour(layer.color, PALETTE.paper), background: bg ?? colour(layer.background, 'transparent'), textShadow: '0 6px 30px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.45)', letterSpacing: '0.01em' };
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

// The typewriter keeps the full text in place and reveals it, so the box does not grow as it types.
const Typed = ({ text, shown }: { text: string; shown: number }) => (
  <>{[...text].map((c, i) => c === '\n' ? <br key={i} /> : <span key={i} style={{ visibility: i < shown ? 'visible' : 'hidden' }}>{c}</span>)}</>
);
const Lines = ({ text }: { text: string }) => <>{text.split('\n').map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}</>;

export const TextBox = ({ layer, x, y, anchor, frame, width }: { layer: TextLayer; x: number; y: number; anchor: Point | null; frame: number; width: number }) => {
  const p = phase(layer, frame);
  if (!p.on) return null;
  const m = motionStyle(layer.enter === 'type' ? 'fade' : layer.enter, layer.exit, layer.enter === 'type' ? Math.min(1, p.enter * 4) : p.enter, p.exit);
  const size = layer.size ?? SIZE[layer.style];
  const band = layer.style === 'band';
  const content = layer.enter === 'type' ? <Typed text={layer.text} shown={Math.ceil([...layer.text].length * p.enter)} /> : <Lines text={layer.text} />;
  const box: CSSProperties = {
    position: 'absolute', left: band ? 0 : x, top: y, width: band ? width : 'max-content', maxWidth: band ? undefined : width * 0.84,
    transform: `translate(${band ? '0' : '-50%'}, -50%) translate(${m.dx}px, ${m.dy}px) scale(${m.scale})`,
    opacity: m.opacity, textAlign: layer.align, whiteSpace: 'pre-wrap', boxSizing: 'border-box', ...look(layer, size),
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
  return <>{pointer}<div style={box}>{content}</div></>;
};
