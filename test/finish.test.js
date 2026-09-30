// The finishing pass, per-shot framing and matching one clip to another: the arithmetic that decides
// whether a cut between four sources reads as one film or as four clips in a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { levelsFrom, matchKnobs, shoulder, shoulderTable } from '../src/grade.js';
import { planEdit } from '../src/edits.js';

const clip = { frames: 300, width: 1080, height: 1920, duration: 10, audio: true, blank: false, track: null };
const other = { frames: 200, width: 1920, height: 1080 };
const plan = (spec) => planEdit({ format: 'vertical', anchors: {}, layers: [], ...spec }, clip, {}, {}, {}, {}, { aaaaaaaaaaaaaaaaaaaaaaaa: other });

// ---- the highlight shoulder ------------------------------------------------------------------------

test('roll-off leaves the picture alone at 0 and bends the highlights over above it', () => {
  for (let i = 0; i <= 20; i++) assert.equal(shoulder(i / 20, 0), i / 20, 'strength 0 is the identity');
  for (const r of [0.15, 0.35, 0.6, 1]) {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const y = shoulder(i / 200, r);
      assert.ok(y >= prev, `r=${r} has to keep rising, not ${y} after ${prev}`);
      assert.ok(y <= 1 && y >= 0, `r=${r}: ${y} is off the scale`);
      prev = y;
    }
    const knee = 1 - 0.65 * r;
    assert.ok(Math.abs(shoulder(knee, r) - knee) < 1e-9, `r=${r}: nothing below the knee moves`);
    assert.ok(shoulder(1, r) < 1, `r=${r}: white has to come down, or nothing rolled off`);
    // Darker than a straight line the whole way up: that IS the roll-off.
    const mid = knee + (1 - knee) / 2;
    assert.ok(shoulder(mid, r) < mid, `r=${r}: halfway up the shoulder should sit below the line`);
  }
});

test('the two halves of the curve meet with the same slope, so no band shows at the knee', () => {
  const h = 1e-5;
  for (const r of [0.2, 0.5, 0.9]) {
    const k = 1 - 0.65 * r;
    const below = (shoulder(k, r) - shoulder(k - h, r)) / h;
    const above = (shoulder(k + h, r) - shoulder(k, r)) / h;
    assert.ok(Math.abs(below - 1) < 1e-3, `r=${r}: below the knee the slope is 1, not ${below}`);
    assert.ok(Math.abs(above - 1) < 1e-2, `r=${r}: the curve has to leave the knee at slope 1, not ${above}`);
  }
});

test('the table handed to the filter is the curve, sampled', () => {
  const t = shoulderTable(0.5, 17);
  assert.equal(t.length, 17);
  t.forEach((v, i) => assert.ok(Math.abs(v - shoulder(i / 16, 0.5)) < 1e-4, `sample ${i}`));
});

// The renderer runs in its own container and cannot import the app, so this curve is written out twice.
// Two copies that quietly stop agreeing would show as a grade and a finish rolling off differently.
test('the renderer keeps the same roll-off arithmetic as the app', () => {
  const tsx = readFileSync(new URL('../remotion/src/edit/filters.tsx', import.meta.url), 'utf8');
  const body = tsx.match(/export const shoulder = \(x: number, rolloff: number\) => \{([\s\S]*?)\n\};/);
  assert.ok(body, 'filters.tsx still has to export a shoulder');
  const js = readFileSync(new URL('../src/grade.js', import.meta.url), 'utf8')
    .match(/export function shoulder\(x, rolloff\) \{([\s\S]*?)\n\}/);
  const strip = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(strip(body[1]), strip(js[1]), 'the app and the renderer have to roll off identically');
});

// ---- measuring and matching ------------------------------------------------------------------------

test('levels read the ends of a picture, not its single darkest and brightest pixel', () => {
  // A grey ramp with one black and one white speck in it: percentiles should ignore both.
  const n = 1000, data = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    const v = Math.round(60 + (120 * p) / (n - 1));
    data[p * 3] = data[p * 3 + 1] = data[p * 3 + 2] = v;
  }
  data.fill(0, 0, 3); data.fill(255, (n - 1) * 3);
  const m = levelsFrom(data, 3);
  assert.ok(m.black > 0.2 && m.black < 0.28, `black sits near the bottom of the ramp, not ${m.black}`);
  assert.ok(m.white > 0.67 && m.white < 0.72, `white near the top of the ramp, not ${m.white}`);
  assert.ok(Math.abs(m.mid - 0.47) < 0.02, `mid in the middle, not ${m.mid}`);
  assert.ok(Math.abs(m.r - m.g) < 0.001 && Math.abs(m.g - m.b) < 0.001, 'a grey ramp has no cast');
});

// The filter's own arithmetic, so a suggestion can be checked against what it will actually do.
const graded = (k, x) => {
  const chan = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const e = 2 ** (k.exposure ?? 0), c = 1 + ((k.contrast ?? 0) >= 0 ? (k.contrast ?? 0) * 1.2 : (k.contrast ?? 0) * 0.85);
  const out = [0, 1, 2].map((i) => {
    const lift = (chan(k.lift ?? '#808080', i) - 0.5) * 0.5, gain = 1 + (chan(k.gain ?? '#808080', i) - 0.5) * 0.5;
    return e * c * (gain - lift) * x[i] + (0.5 - 0.5 * c) * (gain - lift) + lift;
  });
  const t = (k.temperature ?? 0) * 0.22, ti = (k.tint ?? 0) * 0.16;
  return [out[0] * (1 + t), out[1] * (1 - ti), out[2] * (1 - t)];
};
const luma = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

test('a clip matched against itself is left alone', () => {
  const m = { black: 0.1, white: 0.8, mid: 0.4, r: 0.4, g: 0.38, b: 0.42 };
  const { knobs, limited, leftover } = matchKnobs(m, m);
  assert.deepEqual(limited, []);
  for (const [k, v] of Object.entries(knobs)) assert.equal(v, 0, `${k} should not move`);
  assert.ok(!('lift' in knobs), 'and no lift, which would tint the shadows for nothing');
  assert.deepEqual(leftover, { black: 0, mid: 0, white: 0 });
});

test('the suggested knobs carry a flat clip towards the reference at every level', () => {
  const reference = { black: 0.02, white: 0.99, mid: 0.42, r: 0.45, g: 0.45, b: 0.45 };
  const flat = { black: 0.20, white: 0.70, mid: 0.44, r: 0.40, g: 0.42, b: 0.38 };
  const { knobs, leftover } = matchKnobs(reference, flat);
  assert.ok(knobs.contrast > 0.3, `a flat clip needs contrast, not ${knobs.contrast}`);
  for (const k of ['black', 'white'])
    assert.ok(Math.abs(leftover[k]) < Math.abs(flat[k] - reference[k]) / 3, `${k} ended ${leftover[k]} out, having started ${(flat[k] - reference[k]).toFixed(3)} out`);
  assert.ok(Math.abs(leftover.mid) < 0.05, `and the mid stays close: ${leftover.mid}`);
  // The reported leftovers are what the knobs really leave behind, not what the fit hoped for.
  const got = luma(graded(knobs, [flat.black, flat.black, flat.black]));
  assert.ok(Math.abs(got - (reference.black + leftover.black)) < 0.02, `black lands on ${got}, and leftover says ${reference.black + leftover.black}`);
  // Colour is solved after the levels, so the cast comes out even though the contrast moved a long way.
  const [r, g, b] = graded(knobs, [flat.r, flat.g, flat.b]);
  assert.ok(Math.abs(r / b - reference.r / reference.b) < 0.03, `red against blue: ${r / b}`);
  assert.ok(Math.abs(g / Math.sqrt(r * b) - 1) < 0.03, `green against the other two: ${g / Math.sqrt(r * b)}`);
});

// An exposure and a contrast are a straight line, and a line cannot pass through three points. Forcing
// black and white onto the reference exactly - which is what this did at first - matched the two ends
// and pushed the MIDTONES 0.16 apart on the real drift footage. Overall brightness is the first thing
// the eye reads on a cut, so that traded a small fault for a bigger one.
//
// What a least-squares fit promises is NOT that every level improves: it can move one that already
// matched, if that is what buys the other two. Two clips whose whites happen to coincide and whose
// blacks are far apart will see the white give way. What it does promise is that the WEIGHTED TOTAL
// never gets worse, because leaving the clip alone (slope 1, offset 0) is itself a candidate the fit
// could have chosen. That is the property worth holding it to.
const WEIGHT = { black: 2, mid: 3, white: 1 };
const sse = (a, b, leftover) => ['black', 'mid', 'white'].reduce((s, k) => s + WEIGHT[k] * (leftover ? leftover[k] : b[k] - a[k]) ** 2, 0);

test('matching never leaves two clips further apart overall than it found them', () => {
  const rnd = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
  const make = (s) => {
    const black = rnd(s) * 0.35, white = Math.min(1, black + 0.25 + rnd(s + 1) * 0.7);
    return { black, white, mid: black + (white - black) * (0.2 + rnd(s + 2) * 0.6), r: 0.25 + rnd(s + 3) * 0.5, g: 0.25 + rnd(s + 4) * 0.5, b: 0.25 + rnd(s + 5) * 0.5 };
  };
  let improved = 0, tested = 0;
  for (let i = 0; i < 2000; i++) {
    const a = make(i * 7 + 1), b = make(i * 7 + 4), { leftover, limited } = matchKnobs(a, b);
    if (limited.includes('exposure') || limited.includes('contrast')) continue; // a clamped knob cannot reach the fit
    tested++;
    const before = sse(a, b, null), after = sse(a, b, leftover);
    assert.ok(after <= before + 1e-3, `pair ${i}: total ${before.toFixed(4)} -> ${after.toFixed(4)}`);
    if (after < before * 0.5) improved++;
  }
  assert.ok(tested > 1500, `enough pairs to mean something, not ${tested}`);
  assert.ok(improved > tested * 0.7, `and most of them improve a lot, not ${improved} of ${tested}`);
});

test('the real drift clips: the midtones are not sacrificed to the two ends', () => {
  // Measured off the server: the vertical Latvia clip and the horizontally cropped stock it cuts to.
  const latvia = { black: 0.1793, mid: 0.5435, white: 0.9222, r: 0.5278, g: 0.5677, b: 0.5483 };
  const stock = { black: 0.0258, mid: 0.549, white: 0.7729, r: 0.4671, g: 0.5085, b: 0.5343 };
  const { leftover } = matchKnobs(latvia, stock);
  assert.ok(Math.abs(leftover.mid) < 0.09, `the mid has to stay close, not ${leftover.mid} out`);
  assert.ok(Math.abs(leftover.black) < 0.05, `and the black point still lands near, not ${leftover.black} out`);
});

test('two clips further apart than the knobs reach say so instead of pretending', () => {
  const golden = { black: 0.05, white: 0.85, mid: 0.35, r: 0.42, g: 0.38, b: 0.30 };
  const cold = { black: 0.12, white: 0.95, mid: 0.50, r: 0.30, g: 0.36, b: 0.48 };
  const { knobs, limited } = matchKnobs(golden, cold);
  assert.ok(limited.includes('temperature'), 'temperature cannot carry a blue clip all the way to golden hour');
  assert.equal(knobs.temperature, 1, 'and it is handed back at its limit, not past it');
});

// ---- the finish layer ------------------------------------------------------------------------------

test('a finish is on from the first frame unless it is asked to fade', () => {
  const l = plan({ layers: [{ type: 'finish', from: 0, to: 100 }] }).spec.layers[0];
  assert.equal(l.in, 0, 'a finishing pass should not ramp up by default');
  assert.equal(l.out, 0);
  assert.ok(l.rolloff > 0 && l.grain > 0 && l.bloom > 0, 'its defaults should already be a pass worth having');
  assert.equal(l.halation, 0, 'but not two kinds of glow at once');
});

test('a grade keeps its roll-off through a save and a read back', () => {
  // The knobs go back through the same strict schema when a saved edit is opened, so a knob that is
  // computed but not declared makes the edit unreadable - only on the SECOND read.
  const first = plan({ layers: [{ type: 'grade', from: 0, to: 100, look: 'vintage-film' }] });
  assert.ok(first.spec.layers[0].knobs.rolloff > 0, 'vintage film rolls its highlights off');
  const again = planEdit(first.spec, clip);
  assert.deepEqual(again.spec.layers[0].knobs, first.spec.layers[0].knobs);
});

// ---- per-shot framing ------------------------------------------------------------------------------

test('a punch-in eases across the whole shot, not across each step of a speed ramp', () => {
  const { plan: p } = plan({ timeline: [{ from: 0, to: 120, speed: 1, ramp: 0.4, reframe: { scale: 1, scaleTo: 1.5 } }] });
  const pieces = p.segments.filter((s) => s.reframe);
  assert.ok(pieces.length > 5, 'a ramp is built as a staircase');
  const spans = new Set(pieces.map((s) => s.shot.join('-')));
  assert.equal(spans.size, 1, 'every step of the staircase shares one shot span');
  assert.deepEqual(pieces[0].shot, [p.segments[0].from, p.segments.at(-1).to]);
});

test('framing and mirroring travel with the shot they belong to', () => {
  const { plan: p, timeline } = plan({
    clips: [{ name: 'wide', footage: 'aaaaaaaaaaaaaaaaaaaaaaaa' }],
    timeline: [{ from: 0, to: 30, reframe: { scale: 1.4, x: 0.3 } }, { clip: 'wide', from: 0, to: 30, mirror: true }],
  });
  assert.equal(p.segments[0].reframe.scale, 1.4);
  assert.equal(p.segments[0].reframe.x, 0.3);
  assert.ok(!p.segments[1].reframe, 'the second shot did not ask for framing');
  assert.equal(p.segments[1].mirror, true);
  assert.equal(timeline[1].mirror, true, 'and it is reported back, so a caller can see it took');
});

test('mirroring the clip the anchors belong to is called out', () => {
  const { warnings } = plan({
    anchors: { cup: [{ frame: 0, x: 0.5, y: 0.5 }] },
    timeline: [{ from: 0, to: 60, mirror: true }],
  });
  assert.ok(warnings.some((w) => /mirrored/.test(w) && /anchors/.test(w)), warnings.join('; '));
});

test('a zoom layer over a shot that frames itself is called out', () => {
  const { warnings } = plan({
    layers: [{ type: 'zoom', from: 0, to: 40, scale: 1.5, focus: { x: 0.5, y: 0.5 } }],
    timeline: [{ from: 0, to: 60, reframe: { scale: 1.2 } }],
  });
  assert.ok(warnings.some((w) => /zoom/.test(w) && /reframe/.test(w)), warnings.join('; '));
});

// ---- slow motion -----------------------------------------------------------------------------------

test('frame blending is only carried where it changes anything', () => {
  const slow = plan({ timeline: [{ from: 0, to: 40, speed: 0.4, smooth: true }] });
  assert.equal(slow.plan.segments[0].smooth, true);
  const fast = plan({ timeline: [{ from: 0, to: 40, speed: 2, smooth: true }] });
  assert.ok(!fast.plan.segments[0].smooth, 'nothing to blend when frames are being dropped');
  assert.ok(fast.warnings.some((w) => /smooth/.test(w)), fast.warnings.join('; '));
  // A ramp only blends the steps that are actually slow.
  const ramp = plan({ timeline: [{ from: 0, to: 120, speed: 1, ramp: 0.3, smooth: true }] });
  const blended = ramp.plan.segments.filter((s) => s.smooth);
  assert.ok(blended.length && blended.length < ramp.plan.segments.length, 'the fast end of the ramp needs no blending');
  assert.ok(blended.every((s) => s.speed < 0.9));
});

test('a shot slow enough to judder is told to blend', () => {
  const { warnings } = plan({ timeline: [{ from: 0, to: 40, speed: 0.4 }] });
  assert.ok(warnings.some((w) => /judder/.test(w)), warnings.join('; '));
  assert.ok(!plan({ timeline: [{ from: 0, to: 40, speed: 0.8 }] }).warnings.some((w) => /judder/.test(w)), 'not for a gentle slow-down');
});
