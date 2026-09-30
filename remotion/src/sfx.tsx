// A sound effect at a frame: one of the files tools/sfx/make.mjs cuts into public/sfx. `frames` cuts it short
// (with a quick fade, so it doesn't click) when the action it goes with is shorter than the recording.
import { Audio, Sequence, staticFile } from 'remotion';

export const Sfx = ({ at, name, volume = 1, frames }: { at: number; name: string; volume?: number; frames?: number }) => (
  <Sequence from={Math.round(at)} durationInFrames={frames ? Math.max(1, Math.round(frames)) : undefined} layout="none">
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={frames ? f => volume * Math.min(1, Math.max(0, (Math.round(frames) - f) / 4)) : volume} />
  </Sequence>
);
