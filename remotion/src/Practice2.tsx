import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export const Practice2x = () => {
  const frame = useCurrentFrame();
  // const { height } = useVideoConfig();
  // const floor = Math.floor(frame / 30);
  const { width, height } = useVideoConfig();

  const size = 80;
  const floor = height - size;
  const right = width - size;
  const mass = 0.3;


  // const y = frame * 20;

  let vx = 30;
  let y = 0;
  let x = 500;
  // const x = 500 + Math.sin(frame * 0.05) * 150;
  let vy = 0;


  for (let f = 0; f < frame; f++) {
    const gravity = mass * 2;

    const air = -vy * 0.08;
    // const airX = -vx * 0.08;
    const target = Math.cos(f * 0.05) * 7.5;

    // const forceX = airX;
    const force = gravity + air;

    vy = vy + force / mass;
    vx = vx + (target - vx) * 0.5;

    x = x + vx;
    y = y + vy;

    if (y > floor) {
      y = floor;
      vy = -vy * 0.7;
    }

    if (x > right) {
      x = right;
      vx = -vx * 0.7;
    }

    if (x < 0) {
      x = 0;
      vx = -vx * 0.7;
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#f1e2bf' }}>
      <div style={{
        position: 'absolute',
        top: y,
        left: x,
        width: size,
        height: size,
        borderRadius: size / 2,
        background: '#a8431c',
      }} />
    </AbsoluteFill>
  );
};