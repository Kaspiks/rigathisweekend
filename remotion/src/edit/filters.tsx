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
// Footage off a phone is soft and carries sensor grain; a rendered model is neither, and that mismatch
// reads as a sticker even once the lighting is right. A sub-pixel blur plus grain closes it.
//
// The grain has to keep the NOISE in its colour channels: overlay against a constant mid grey is an
// identity operation, so flattening the turbulence to 0.5 produces a filter that costs time and
// changes nothing. Instead the noise is compressed toward 0.5 by `amount` - full range would be a
// snowstorm - and then clipped to the model's own alpha so it never lands on the footage. Its seed
// moves with the frame, because grain that holds still reads as texture stuck to the model.
export const SoftenFilter = ({ id, amount, frame }: { id: string; amount: number; frame: number }) => {
  const k = amount * 0.35;                 // how far the noise swings either side of mid grey
  const bias = (0.5 - 0.5 * k).toFixed(4); // keeps the compressed noise centred on 0.5
  const grey = `${k.toFixed(4)} 0 0 0 ${bias}`;
  return (
    <filter id={id} x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={(amount * 1.8).toFixed(2)} result="soft" />
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed={1 + (frame % 53)} result="noise" />
      <feColorMatrix in="noise" type="matrix" result="grey"
        values={`${grey}  ${grey}  ${grey}  0 0 0 0 1`} />
      <feComposite in="grey" in2="soft" operator="in" result="onModel" />
      <feBlend in="soft" in2="onModel" mode="overlay" result="grained" />
      <feComposite in="grained" in2="soft" operator="in" />
    </filter>
  );
};

export const BoilFilter = ({ id, frame }: { id: string; frame: number }) => (
  <filter id={id} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
    <Boil input="SourceGraphic" seed={boilSeed(frame)} amount={6} />
  </filter>
);

// Colour grading. Exposure, contrast, lift/gain and fade are all straight lines on each channel, so they
// are composed into ONE slope and intercept per channel rather than stacked as four passes: fewer
// passes, and no rounding to 8 bits between each of them. Temperature, tint and saturation are a matrix
// after that, and the grain goes on last so it is not itself stretched by the contrast.
export type Knobs = { exposure: number; contrast: number; saturation: number; temperature: number; tint: number; lift: string; gain: string; fade: number; vignette: number; grain: number; halation?: number; aberration?: number };
const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;

export const GradeFilter = ({ id, knobs, frame }: { id: string; knobs: Knobs; frame: number }) => {
  const e = 2 ** knobs.exposure;
  const c = 1 + (knobs.contrast >= 0 ? knobs.contrast * 1.2 : knobs.contrast * 0.85);
  const f = knobs.fade * 0.28;
  const line = (i: number) => {
    // y = lift + (gain − lift)·x, over contrast(exposure(x)), then faded towards a milky black.
    const lift = (channel(knobs.lift, i) - 0.5) * 0.5, gain = 1 + (channel(knobs.gain, i) - 0.5) * 0.5;
    let slope = e * c * (gain - lift), intercept = (0.5 - 0.5 * c) * (gain - lift) + lift;
    slope *= 1 - f; intercept = intercept * (1 - f) + f;
    return { slope: +slope.toFixed(5), intercept: +intercept.toFixed(5) };
  };
  const [r, g, b] = [line(0), line(1), line(2)];
  // Warmth pulls red up and blue down; tint trades green against magenta.
  const t = knobs.temperature * 0.22, ti = knobs.tint * 0.16;
  const warm = [1 + t, 0, 0, 0, 0, 0, 1 - ti, 0, 0, 0, 0, 0, 1 - t, 0, 0, 0, 0, 0, 1, 0].join(' ');
  const grain = knobs.grain * 0.38, halation = knobs.halation ?? 0, fringe = (knobs.aberration ?? 0) * 6;
  const last = fringe > 0 ? 'split' : halation > 0 ? 'bloomed' : 'graded';
  const bias = (0.5 - 0.5 * grain).toFixed(4), k = grain.toFixed(4);
  const grey = `${k} 0 0 0 ${bias}`;
  return (
    <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feComponentTransfer in="SourceGraphic" result="levels">
        <feFuncR type="linear" slope={r.slope} intercept={r.intercept} />
        <feFuncG type="linear" slope={g.slope} intercept={g.intercept} />
        <feFuncB type="linear" slope={b.slope} intercept={b.intercept} />
      </feComponentTransfer>
      <feColorMatrix in="levels" type="matrix" values={warm} result="warmed" />
      <feColorMatrix in="warmed" type="saturate" values={Math.max(0, 1 + knobs.saturation).toFixed(4)} result="graded" />
      {/* Halation: film's highlights bleed into the emulsion around them, warm and soft. Keep only the
          bright parts, blur them wide, push them red, and add that back on top of the picture. */}
      {halation > 0 ? (
        <>
          <feComponentTransfer in="graded" result="tops">
            <feFuncR type="linear" slope="3.2" intercept="-2.1" />
            <feFuncG type="linear" slope="3.2" intercept="-2.1" />
            <feFuncB type="linear" slope="3.2" intercept="-2.1" />
          </feComponentTransfer>
          <feGaussianBlur in="tops" stdDeviation={(6 + halation * 26).toFixed(1)} result="bloom" />
          <feColorMatrix in="bloom" type="matrix" result="warmBloom"
            values="1.15 0.05 0 0 0  0 0.62 0 0 0  0 0 0.34 0 0  0 0 0 1 0" />
          <feComposite in="warmBloom" in2="graded" operator="arithmetic" k1="0" k2={(halation * 0.9).toFixed(3)} k3="1" k4="0" result="bloomed" />
        </>
      ) : null}
      {/* Chromatic aberration: red and blue pulled apart, the way a cheap lens fails to land all three
          colours in the same place. */}
      {fringe > 0 ? (
        <>
          <feColorMatrix in={halation > 0 ? 'bloomed' : 'graded'} type="matrix" result="onlyR" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feOffset in="onlyR" dx={(-fringe).toFixed(2)} result="shiftR" />
          <feColorMatrix in={halation > 0 ? 'bloomed' : 'graded'} type="matrix" result="onlyG" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feColorMatrix in={halation > 0 ? 'bloomed' : 'graded'} type="matrix" result="onlyB" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
          <feOffset in="onlyB" dx={fringe.toFixed(2)} result="shiftB" />
          <feComposite in="shiftR" in2="onlyG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
          <feComposite in="rg" in2="shiftB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="split" />
        </>
      ) : null}
      {grain > 0 ? (
        <>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={1 + (frame % 71)} result="noise" />
          <feColorMatrix in="noise" type="matrix" values={`${grey}  ${grey}  ${grey}  0 0 0 0 1`} result="film" />
          <feBlend in={last} in2="film" mode="overlay" />
        </>
      ) : last === 'graded' ? null : <feComposite in={last} in2={last} operator="over" />}
    </filter>
  );
};
