// Redrawing live footage as a drawing, with SVG filters Chrome applies to each frame: flattened colours,
// outlines found from the picture's own edges, and a "boil" that wobbles the lines every third frame the
// way hand-drawn animation does. No model, no network: the same frame always comes out the same.
import type { ReactNode } from 'react';
import type { IllustrateLayer } from './model';
import { PALETTE, colour } from './model';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const levels = (n: number) => Array.from({ length: n }, (_, i) => (0.06 + (0.94 * i) / (n - 1)).toFixed(3)).join(' ');

const Posterize = ({ input, n, result }: { input: string; n: number; result: string }) => (
  <feComponentTransfer in={input} result={result}>
    <feFuncR type="discrete" tableValues={levels(n)} />
    <feFuncG type="discrete" tableValues={levels(n)} />
    <feFuncB type="discrete" tableValues={levels(n)} />
  </feComponentTransfer>
);

// Flat colour areas without the false hues of flattening each channel on its own (greys turning
// purple): the flattened picture is mixed back with a little of the smooth one.
const Flat = ({ input, n, result }: { input: string; n: number; result: string }) => (
  <>
    <Posterize input={input} n={n} result={`${result}-steps`} />
    <feComposite in={`${result}-steps`} in2={input} operator="arithmetic" k2={0.72} k3={0.28} result={result} />
  </>
);

// Outlines, drawn the way a cartoonist would: where the picture is darker than its surroundings (the
// difference of a fine and a coarse blur of its brightness), strong enough to matter. `weight` sets how
// bold the lines are, `detail` how much small texture turns into lines, `alpha` their strongest opacity.
// The blurs are wide enough that phone-camera grain and wood grain do not become lines.
const Lines = ({ weight, detail, color, alpha = 1, fine = 2.6, coarse = 5.5, result }: { weight: number; detail: number; color: string; alpha?: number; fine?: number; coarse?: number; result: string }) => {
  const [r, g, b] = rgb(color);
  const gain = 5, k = weight * alpha, t = (1 - detail) * 0.7 * alpha;
  return (
    <>
      <feColorMatrix in="SourceGraphic" type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" result={`${result}-grey`} />
      <feGaussianBlur in={`${result}-grey`} stdDeviation={fine} result={`${result}-fine`} />
      <feGaussianBlur in={`${result}-grey`} stdDeviation={coarse} result={`${result}-coarse`} />
      <feComponentTransfer in={`${result}-coarse`} result={`${result}-inverse`}>
        <feFuncR type="linear" slope={-1} intercept={1} /><feFuncG type="linear" slope={-1} intercept={1} /><feFuncB type="linear" slope={-1} intercept={1} />
      </feComponentTransfer>
      {/* 0.5 where nothing changes, darker where the fine blur is darker than the coarse one. */}
      <feComposite in={`${result}-fine`} in2={`${result}-inverse`} operator="arithmetic" k2={gain} k3={gain} k4={0.5 - gain} result={`${result}-dog`} />
      <feColorMatrix in={`${result}-dog`} type="matrix" values={`0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${-k} 0 0 0 ${(0.5 * k - t).toFixed(3)}`} result={`${result}-raw`} />
      {/* Shrinking the lines and growing them back removes lone specks of grain but keeps real strokes. */}
      <feMorphology in={`${result}-raw`} operator="erode" radius={1} result={`${result}-thin`} />
      <feMorphology in={`${result}-thin`} operator="dilate" radius={1.2} result={result} />
    </>
  );
};

const Paper = ({ input, result, seed }: { input: string; result: string; seed: number }) => (
  <>
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} result={`${result}-grain`} />
    <feColorMatrix in={`${result}-grain`} type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.32  0 0 0 0 0.25  0 0 0 0.1 0" result={`${result}-tint`} />
    <feComposite in={`${result}-tint`} in2={input} operator="over" result={result} />
  </>
);

// The wobble: displacement by noise whose pattern changes every third frame ("on threes").
const Boil = ({ input, seed, amount }: { input: string; seed: number; amount: number }) => (
  <>
    <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves={2} seed={seed} result="boil-noise" />
    <feDisplacementMap in={input} in2="boil-noise" scale={amount} xChannelSelector="R" yChannelSelector="G" />
  </>
);

export const boilSeed = (frame: number) => 1 + (Math.floor(frame / 3) % 97);

function body(layer: IllustrateLayer, seed: number): ReactNode {
  switch (layer.style) {
    case 'ink':
      return (<>
        <feGaussianBlur in="SourceGraphic" stdDeviation={3.5} result="soft" />
        <feColorMatrix in="soft" type="saturate" values="1.05" result="sat" />
        <Flat input="sat" n={7} result="flat" />
        <Lines weight={9} detail={0.55} color={PALETTE.black} result="lines" />
        <feComposite in="lines" in2="flat" operator="over" result="drawn" />
      </>);
    case 'sketch':
      return (<>
        <feGaussianBlur in="SourceGraphic" stdDeviation={3.5} result="soft" />
        <Lines weight={10} detail={0.6} color="#262626" result="lines" />
        <feColorMatrix in="soft" type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" result="grey" />
        <feComponentTransfer in="grey" result="shade">
          <feFuncR type="discrete" tableValues="0.5 0.74 0.94" /><feFuncG type="discrete" tableValues="0.5 0.74 0.94" /><feFuncB type="discrete" tableValues="0.5 0.74 0.94" />
        </feComponentTransfer>
        <feFlood floodColor={PALETTE.paper} result="paper" />
        <feBlend in="shade" in2="paper" mode="multiply" result="toned" />
        <feComposite in="lines" in2="toned" operator="over" result="lined" />
        <Paper input="lined" result="drawn" seed={seed} />
      </>);
    case 'watercolor':
      return (<>
        <feGaussianBlur in="SourceGraphic" stdDeviation={5} result="soft" />
        <feColorMatrix in="soft" type="saturate" values="1.2" result="sat" />
        <Flat input="sat" n={6} result="flat" />
        <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={3} seed={seed + 11} result="bleed-noise" />
        <feDisplacementMap in="flat" in2="bleed-noise" scale={16} xChannelSelector="R" yChannelSelector="G" result="bleed" />
        <Lines weight={6} detail={0.4} color={PALETTE.ink} alpha={0.55} result="lines" />
        <feComposite in="lines" in2="bleed" operator="over" result="lined" />
        <Paper input="lined" result="drawn" seed={seed} />
      </>);
    case 'duotone': {
      const [dark, light] = [colour(layer.colors?.[0], PALETTE.ink), colour(layer.colors?.[1], PALETTE.lime)].map(rgb);
      return (<>
        <feGaussianBlur in="SourceGraphic" stdDeviation={2.5} result="soft" />
        <feColorMatrix in="soft" type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" result="grey" />
        <feComponentTransfer in="grey" result="drawn">
          <feFuncR type="table" tableValues={`${dark[0]} ${light[0]}`} />
          <feFuncG type="table" tableValues={`${dark[1]} ${light[1]}`} />
          <feFuncB type="table" tableValues={`${dark[2]} ${light[2]}`} />
        </feComponentTransfer>
      </>);
    }
    case 'posterize':
      return (<>
        <feGaussianBlur in="SourceGraphic" stdDeviation={3.5} result="soft" />
        <feColorMatrix in="soft" type="saturate" values="1.2" result="sat" />
        <Posterize input="sat" n={4} result="drawn" />
      </>);
    case 'cel':
    default:
      return (<>
        <feGaussianBlur in="SourceGraphic" stdDeviation={5} result="soft" />
        <feColorMatrix in="soft" type="saturate" values="1.05" result="sat" />
        <Flat input="sat" n={6} result="flat" />
        <Lines weight={7} detail={0.4} color={PALETTE.ink} result="lines" />
        <feComposite in="lines" in2="flat" operator="over" result="drawn" />
      </>);
  }
}

export const IllustrationFilter = ({ id, layer, frame }: { id: string; layer: IllustrateLayer; frame: number }) => {
  const seed = boilSeed(frame);
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      {body(layer, seed)}
      {layer.boil ? <Boil input="drawn" seed={seed} amount={layer.style === 'sketch' ? 5 : 7} /> : <feMerge><feMergeNode in="drawn" /></feMerge>}
    </filter>
  );
};

// The same wobble for an uploaded drawing (image layers with motion "boil").
export const BoilFilter = ({ id, frame }: { id: string; frame: number }) => (
  <filter id={id} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
    <Boil input="SourceGraphic" seed={boilSeed(frame)} amount={6} />
  </filter>
);
