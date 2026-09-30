import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
// import { size } from 'zod/v4/mini';

export const Practice4x = () => {
  const frame = useCurrentFrame();
  // const { height } = useVideoConfig();
  // const floor = Math.floor(frame / 30);
  const { width, height } = useVideoConfig();

  // const size = 80;

  // const mass = 0.3;

  const balls = [
    { x: 100, y: 500, vx: 10, vy: 0, mass: 3, size: 80, color: '#a8431c' },
    { x: 400, y: 500, vx: -10, vy: 0, mass: 2, size: 80, color: '#5b1ca8' },
  ];

//   // const y = frame * 20;

//   let vx = 30;
//   let y = 0;
//   let x = 500;
//   // const x = 500 + Math.sin(frame * 0.05) * 150;
//   let vy = 0;


  for (let f = 0; f < frame; f++) {
    for (const ball of balls) {
        const gravity = 0;

        const air = -ball.vy * 0.08;
        const airX = -ball.vx * 0.08;
        // const target = Math.cos(f * 0.05) * 150;

        const forceX = airX;
        const force = gravity + air;

        ball.vy = ball.vy + force / ball.mass;
        ball.vx = ball.vx + forceX / ball.mass;

        ball.x = ball.x + ball.vx;
        ball.y = ball.y + ball.vy;

        const floor = height - ball.size;
        const right = width - ball.size;

        if (ball.y > floor) {
          ball.y = floor;
          ball.vy = -ball.vy * 0.7;
        }

        if (ball.x > right) {
          ball.x = right;
          ball.vx = -ball.vx * 0.7;
        }

        if (ball.x < 0) {
          ball.x = 0;
          ball.vx = -ball.vx * 0.7;
        }
    // const gravity = mass * 2;

    // const air = -vy * 0.08;
    // // const airX = -vx * 0.08;
    // const target = Math.cos(f * 0.05) * 7.5;

    // // const forceX = airX;
    // const force = gravity + air;

    // vy = vy + force / mass;
    // vx = vx + (target - vx) * 0.5;

    // x = x + vx;
    // y = y + vy;

    // if (y > floor) {
    //   y = floor;
    //   vy = -vy * 0.7;
    // }

    // if (x > right) {
    //   x = right;
    //   vx = -vx * 0.7;
    // }

    // if (x < 0) {
    //   x = 0;
    //   vx = -vx * 0.7;
    // }

    }

    const a = balls[0];
    const b = balls[1];
    // const dx = a.x - b.x, dy = a.y - b.y;
    // const d = Math.hypot(dx, dy), r = (a.size + b.size) / 2;
    const centerA = a.x + a.size / 2;
    const centerB = b.x + b.size / 2;
    const dx = centerA - centerB;
    const d = Math.abs(dx);
    const minD = (a.size + b.size) / 2;

    if (d < minD) {
      const overlap = minD - d;
      const ia = 1 / a.mass;
      const ib = 1 / b.mass;

      const dir = centerA < centerB ? -1 : 1;
      a.x += dir * overlap * (ia / (ia + ib));
      b.x -= dir * overlap * (ib / (ia + ib));

      const approach = (a.vx - b.vx) * dir;

      if (approach < 0) {
        const bounce = 1;
        const J = -(1 + bounce) * approach / (ia + ib);
        a.vx += J * ia * dir;
        b.vx -= J * ib * dir;
      }
      // const shareA = ia / (ia + ib);
      // const shareB = ib / (ia + ib);

      // if (centerA < centerB) {
      //   a.x -= overlap * shareA;
      //   b.x += overlap * shareB;
      // } else {
      //   a.x += overlap * shareA;
      //   b.x -= overlap * shareB;
      // }

      // const temp = a.vx;
      // a.vx = b.vx;
      // b.vx = temp;


    }
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#f1e2bf' }}>
      {balls.map((ball, index) => (
          <div key={index} style={{
              position: 'absolute',
              top: ball.y,
              left: ball.x,
              width: ball.size,
              height: ball.size,
              borderRadius: ball.size / 2,
              background: ball.color,
          }} />
      ))}
    </AbsoluteFill>
  );
};