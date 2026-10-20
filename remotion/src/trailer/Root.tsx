// The "Of the Empire" trailer plates: one composition per shot, each with HANDLE frames either side.
// Rendered on their own (not part of the render service), then uploaded into the Riga footage library.
import { Composition } from 'remotion';
import { HANDLE, HEIGHT, TRAILER_FPS, WIDTH } from './common';
import { Apparatus } from './Apparatus';
import { Commodity } from './Commodity';
import { Empire } from './Empire';
import { Heart } from './Heart';
import { RiverScene } from './River';
import { Wealth } from './Wealth';

// Shot lengths in OUTPUT frames of the edit, before handles.
export const SHOTS = { empire: 407, wealth: 144, river: 231, commodity: 134, apparatus: 292, heart: 337 } as const;
const length = (frames: number) => frames + HANDLE * 2;

export const TrailerRoot = () => (
  <>
    <Composition id="TrailerEmpire" component={Empire} durationInFrames={length(SHOTS.empire)} fps={TRAILER_FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="TrailerWealth" component={Wealth} durationInFrames={length(SHOTS.wealth)} fps={TRAILER_FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="TrailerRiver" component={RiverScene} durationInFrames={length(SHOTS.river)} fps={TRAILER_FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="TrailerCommodity" component={Commodity} durationInFrames={length(SHOTS.commodity)} fps={TRAILER_FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="TrailerApparatus" component={Apparatus} durationInFrames={length(SHOTS.apparatus)} fps={TRAILER_FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="TrailerHeart" component={Heart} durationInFrames={length(SHOTS.heart)} fps={TRAILER_FPS} width={WIDTH} height={HEIGHT} />
  </>
);
