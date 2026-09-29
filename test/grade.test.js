import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, LOOK_NAMES, lookKnobs, matchLooks, NEUTRAL } from '../src/grade.js';
import { planEdit } from '../src/edits.js';

const clip = { frames: 300, width: 1080, height: 1920, duration: 10, audio: true, blank: false, track: null };
const plan = (layers, timeline) => planEdit({ format: 'vertical', anchors: {}, layers, ...(timeline ? { timeline } : {}) }, clip);

test('every look on the board says what it is for and what colours it pulls towards', () => {
  assert.ok(LOOK_NAMES.length >= 8, 'a board worth having');
  for (const name of LOOK_NAMES) {
    const look = LOOKS[name];
    assert.match(look.about, /\w+ \w+/, `${name} needs a description a model can read`);
    assert.ok(look.palette.length >= 3, `${name} needs enough colours to match against`);
    for (const c of look.palette) assert.match(c, /^#[0-9a-f]{6}$/, `${name}: ${c}`);
    for (const k of Object.keys(look.set)) assert.ok(k in NEUTRAL, `${name} sets an unknown knob ${k}`);
  }
});

test('a look mixes in from nothing at strength 0 to all of it at 1', () => {
  assert.deepEqual(lookKnobs('noir', 0), NEUTRAL, 'strength 0 leaves the picture alone');
  const full = lookKnobs('noir', 1);
  assert.equal(full.saturation, LOOKS.noir.set.saturation);
  const half = lookKnobs('noir', 0.5);
  assert.ok(half.saturation > full.saturation && half.saturation < 0, `half way, not ${half.saturation}`);
});

test('a shot is matched to the looks that suit its colours', () => {
  const warm = [{ rgb: [201, 127, 69], share: 0.4 }, { rgb: [23, 80, 92], share: 0.4 }, { rgb: [240, 196, 138], share: 0.2 }];
  assert.equal(matchLooks(warm, 1)[0].look, 'teal-orange', 'warm subject against cool shadows');
  const grey = [{ rgb: [20, 23, 26], share: 0.5 }, { rgb: [163, 165, 159], share: 0.5 }];
  assert.ok(['bleach-bypass', 'noir'].includes(matchLooks(grey, 1)[0].look), 'drained and contrasty');
  const night = [{ rgb: [8, 6, 15], share: 0.6 }, { rgb: [179, 49, 154], share: 0.2 }, { rgb: [63, 208, 224], share: 0.2 }];
  assert.equal(matchLooks(night, 1)[0].look, 'neon-night');
  for (const m of matchLooks(warm, 4)) assert.ok(m.fit >= 0 && m.fit <= 100, `fit out of range: ${m.fit}`);
});

test('a grade keeps its worked-out knobs when the saved edit is read back', () => {
  // planEdit fills in `knobs` after parsing, so a saved spec goes through the schema WITH them on it.
  // Getting this wrong breaks every preview and render of an edit that saved perfectly well.
  const first = plan([{ type: 'grade', from: 0, to: 200, look: 'moonlight' }]);
  const knobs = first.spec.layers[0].knobs;
  assert.ok(knobs && knobs.temperature < 0, 'moonlight is cold');
  const again = planEdit(first.spec, clip);
  assert.deepEqual(again.spec.layers[0].knobs, knobs, 'the same edit plans the same way twice');
});

test('a grade knob set by the edit beats the look it came from', () => {
  const { spec } = plan([{ type: 'grade', from: 0, to: 200, look: 'noir', grain: 0.5, saturation: 0.3 }]);
  assert.equal(spec.layers[0].knobs.grain, 0.5);
  assert.equal(spec.layers[0].knobs.saturation, 0.3, 'not noir\'s -1');
  assert.equal(spec.layers[0].knobs.contrast, LOOKS.noir.set.contrast, 'what was not overridden still comes from the look');
});

test('two grades at once are refused, one after the other is fine', () => {
  assert.throws(() => plan([{ type: 'grade', from: 0, to: 200, look: 'noir' }, { type: 'grade', from: 100, to: 300, look: 'moonlight' }]), /one grade at a time/);
  assert.doesNotThrow(() => plan([{ type: 'grade', from: 0, to: 150, look: 'noir' }, { type: 'grade', from: 150, to: 300, look: 'moonlight' }]));
});

test('a dissolve overlaps the shots, so the edit gets shorter', () => {
  const cut = plan([], [{ from: 0, to: 60 }, { from: 100, to: 160 }]);
  assert.equal(cut.plan.durationInFrames, 120);
  const mixed = plan([], [{ from: 0, to: 60 }, { from: 100, to: 160, dissolve: 12 }]);
  assert.equal(mixed.plan.durationInFrames, 108, 'twelve frames of overlap');
  assert.equal(mixed.plan.segments[1].dissolve, 12);
  assert.equal(mixed.plan.segments[1].from, 48, 'the second shot starts inside the first');
});

test('the first shot has nothing to dissolve from, and a long dissolve is cut to fit', () => {
  const first = plan([], [{ from: 0, to: 60, dissolve: 20 }]);
  assert.equal(first.plan.durationInFrames, 60);
  assert.equal(first.plan.segments[0].dissolve, undefined);
  const long = plan([], [{ from: 0, to: 20 }, { from: 100, to: 160, dissolve: 60 }]);
  assert.equal(long.plan.segments[1].dissolve, 20, 'no longer than the shot before it');
});

test('a speed ramp is a staircase between the two rates, ending where it was asked to', () => {
  const { plan: p } = plan([], [{ from: 0, to: 120, speed: 1, ramp: 0.4 }]);
  const rates = p.segments.map(s => s.speed);
  assert.ok(rates.length > 4, 'stepped, not one piece');
  assert.ok(Math.abs(rates[0] - 1) < 0.1 && Math.abs(rates.at(-1) - 0.4) < 0.1, `runs ${rates[0]} -> ${rates.at(-1)}`);
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i] <= rates[i - 1] + 1e-9, 'slows all the way down, never back up');
  assert.equal(p.segments[0].source, 0);
  assert.equal(p.segments.at(-1).sourceTo, 120, 'the shot still ends exactly where it was asked to');
});

test('an edit with no timeline of its own still plans', () => {
  // The default timeline is a plain object that never goes through the schema, so anything planEdit
  // reads off a timeline entry has to cope with the field being absent.
  const { plan: p } = plan([]);
  assert.equal(p.durationInFrames, clip.frames);
  assert.equal(p.segments.length, 1);
  assert.ok(Number.isInteger(p.segments[0].to), `to is ${p.segments[0].to}`);
});
