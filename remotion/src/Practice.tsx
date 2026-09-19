import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export const Practice = () => {
  const frame = useCurrentFrame();
  // const { height } = useVideoConfig();
  // const floor = Math.floor(frame / 30);
  const { width, height } = useVideoConfig();

  const size = 80;
  const floor = height - size;
  const right = width - size;
  const mass = 2;

  // const y = frame * 20;

  let vx = 65;
  let y = 0;
  let x =  50;
  let vy = 0;


  for (let f = 0; f < frame; f++) {
    const gravity = mass * 3;

    const air = -vy * 0.05;
    const airX = -vx * 0.05;

    // const forceX = airX;
    const force = gravity + air;

    vy = vy + force / mass;
    vx = vx + airX / mass;

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