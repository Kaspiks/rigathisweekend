// Redrawing live footage as a drawing, with SVG filters Chrome applies to each frame: flattened colours,
// outlines found from the picture's own edges, and a "boil" that wobbles the lines every third frame the
// way hand-drawn animation does. No model, no network: the same frame always comes out the same.
import { Fragment, type ReactNode } from 'react';
import type { FinishLayer, IllustrateLayer } from './model';
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

// Highlight roll-off: the shoulder a film stock has and a sensor does not. Below the knee nothing
// changes; above it the highlights are squeezed into a smaller range and reach white with no slope left,
// so a blown sky bends over instead of hitting a flat wall of white.
//
// The exponent is not a taste number: it is whatever makes the slope exactly 1 where the straight part
// meets the curve, so no bright band appears at the knee. With the knee at 1 − 0.65r and white landing
// at 1 − 0.10r, that works out to 13/11 at every strength.
//
// This is the same arithmetic as `shoulder` in src/grade.js. It lives in both because the renderer runs
// in its own container and cannot import the app; test/grade.test.js checks the two still agree.
export const shoulder = (x: number, rolloff: number) => {
  const r = Math.max(0, Math.min(1, rolloff || 0));
  if (!r || x <= 1 - 0.65 * r) return x;
  const k = 1 - 0.65 * r, top = 1 - 0.1 * r, d = (x - k) / (1 - k);
  return k + (top - k) * (1 - (1 - d) ** (13 / 11));
};
// feComponentTransfer reads a table as straight lines between its samples, which is close enough to the
// curve at seventeen of them that the join is invisible.
export const shoulderTable = (rolloff: number, n = 17) =>
  Array.from({ length: n }, (_, i) => +shoulder(i / (n - 1), rolloff).toFixed(4)).join(' ');

const Shoulder = ({ input, rolloff, result }: { input: string; rolloff: number; result: string }) => {
  const t = shoulderTable(rolloff);
  return (
    <feComponentTransfer in={input} result={result}>
      <feFuncR type="table" tableValues={t} /><feFuncG type="table" tableValues={t} /><feFuncB type="table" tableValues={t} />
    </feComponentTransfer>
  );
};

// Only the bright parts of the picture, which is what bloom and halation are made of: everything below
// about two thirds goes to black, and what is left is stretched back up.
const Tops = ({ input, result }: { input: string; result: string }) => (
  <feComponentTransfer in={input} result={result}>
    <feFuncR type="linear" slope="3.2" intercept="-2.1" />
    <feFuncG type="linear" slope="3.2" intercept="-2.1" />
    <feFuncB type="linear" slope="3.2" intercept="-2.1" />
  </feComponentTransfer>
);

// Grain as a noise field compressed towards mid grey and blended in overlay, which leaves the picture's
// own brightness alone. The seed moves with the frame, because grain that holds still reads as dirt on
// the lens rather than grain in the stock.
const Grain = ({ input, amount, frame }: { input: string; amount: number; frame: number }) => {
  const bias = (0.5 - 0.5 * amount).toFixed(4), k = amount.toFixed(4), row = `${k} 0 0 0 ${bias}`;
  return (
    <>
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={1 + (frame % 71)} result="noise" />
      <feColorMatrix in="noise" type="matrix" values={`${row}  ${row}  ${row}  0 0 0 0 1`} result="film" />
      <feBlend in={input} in2="film" mode="overlay" />
    </>
  );
};

// Colour grading. Exposure, contrast, lift/gain and fade are all straight lines on each channel, so they
// are composed into ONE slope and intercept per channel rather than stacked as four passes: fewer
// passes, and no rounding to 8 bits between each of them. Temperature, tint and saturation are a matrix
// after that, and the grain goes on last so it is not itself stretched by the contrast.
export type Knobs = { exposure: number; contrast: number; saturation: number; temperature: number; tint: number; lift: string; gain: string; fade: number; vignette: number; grain: number; halation?: number; aberration?: number; rolloff?: number };
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
  const grain = knobs.grain * 0.38, halation = knobs.halation ?? 0, fringe = (knobs.aberration ?? 0) * 6, roll = knobs.rolloff ?? 0;
  const last = fringe > 0 ? 'split' : halation > 0 ? 'bloomed' : 'graded';
  return (
    <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feComponentTransfer in="SourceGraphic" result="levels">
        <feFuncR type="linear" slope={r.slope} intercept={r.intercept} />
        <feFuncG type="linear" slope={g.slope} intercept={g.intercept} />
        <feFuncB type="linear" slope={b.slope} intercept={b.intercept} />
      </feComponentTransfer>
      <feColorMatrix in="levels" type="matrix" values={warm} result="warmed" />
      <feColorMatrix in="warmed" type="saturate" values={Math.max(0, 1 + knobs.saturation).toFixed(4)} result={roll > 0.002 ? 'sat' : 'graded'} />
      {/* The shoulder goes on after the levels, so it catches whatever the exposure and contrast pushed
          up, and before the bloom, so halation is made from highlights that have already bent over. */}
      {roll > 0.002 ? <Shoulder input="sat" rolloff={roll} result="graded" /> : null}
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
      {grain > 0 ? <Grain input={last} amount={grain} frame={frame} />
        : last === 'graded' ? null : <feComposite in={last} in2={last} operator="over" />}
    </filter>
  );
};

// The finishing pass: the same physics as a grade, but over the WHOLE frame instead of the pictures, and
// with no colour in it. Two clips shot on different cameras can be matched to each other by grading them
// separately and still sit apart, because each still carries its own highlight behaviour and its own
// (or no) texture. One shoulder, one glow and one grain over everything - titles included, as they would
// be on a print - is what closes that gap, and it is the last thing that happens to the frame.
export const FinishFilter = ({ id, layer, amount, frame }: { id: string; layer: FinishLayer; amount: number; frame: number }) => {
  const roll = layer.rolloff * amount, bloom = layer.bloom * amount, halation = layer.halation * amount;
  const grain = layer.grain * amount * 0.34, fringe = layer.aberration * amount * 5;
  const steps: ReactNode[] = [];
  let last = 'SourceGraphic';
  if (roll > 0.002) { steps.push(<Shoulder key="roll" input={last} rolloff={roll} result="rolled" />); last = 'rolled'; }
  // Bloom is a diffusion filter on the lens: a neutral white glow that puts everything in the same air.
  // Halation is the same shape but warm, the way film's highlights bleed red into the emulsion around
  // them. Each adds its glow on top rather than replacing the picture, so nothing gets darker.
  if (bloom > 0.002) {
    steps.push(
      <Fragment key="bloom">
        <Tops input={last} result="btops" />
        <feGaussianBlur in="btops" stdDeviation={(5 + bloom * 20).toFixed(1)} result="bglow" />
        <feComposite in="bglow" in2={last} operator="arithmetic" k1="0" k2={(bloom * 0.75).toFixed(3)} k3="1" k4="0" result="bloomed" />
      </Fragment>,
    );
    last = 'bloomed';
  }
  if (halation > 0.002) {
    steps.push(
      <Fragment key="halo">
        <Tops input={last} result="htops" />
        <feGaussianBlur in="htops" stdDeviation={(6 + halation * 26).toFixed(1)} result="hglow" />
        <feColorMatrix in="hglow" type="matrix" result="hwarm" values="1.15 0.05 0 0 0  0 0.62 0 0 0  0 0 0.34 0 0  0 0 0 1 0" />
        <feComposite in="hwarm" in2={last} operator="arithmetic" k1="0" k2={(halation * 0.9).toFixed(3)} k3="1" k4="0" result="haloed" />
      </Fragment>,
    );
    last = 'haloed';
  }
  if (fringe > 0.002) {
    steps.push(
      <Fragment key="fringe">
        <feColorMatrix in={last} type="matrix" result="fR" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feOffset in="fR" dx={(-fringe).toFixed(2)} result="fRs" />
        <feColorMatrix in={last} type="matrix" result="fG" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feColorMatrix in={last} type="matrix" result="fB" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        <feOffset in="fB" dx={fringe.toFixed(2)} result="fBs" />
        <feComposite in="fRs" in2="fG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="fRG" />
        <feComposite in="fRG" in2="fBs" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="split" />
      </Fragment>,
    );
    last = 'split';
  }
  return (
    <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      {steps}
      {grain > 0.002 ? <Grain input={last} amount={grain} frame={frame} />
        // A filter has to end on something; with every knob at zero it ends on the picture unchanged.
        : last === 'SourceGraphic' ? <feComposite in="SourceGraphic" in2="SourceGraphic" operator="over" />
          : <feComposite in={last} in2={last} operator="over" />}
    </filter>
  );
};

// Is this finish doing anything at all? A layer with every knob at zero should cost nothing.
export const finishes = (layer: FinishLayer, amount: number) =>
  amount > 0.002 && (layer.rolloff > 0 || layer.grain > 0 || layer.bloom > 0 || layer.halation > 0 || layer.aberration > 0);
