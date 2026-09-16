import { spawn } from 'node:child_process';

// Encoders for raw RGBA frames piped into ffmpeg. `alpha` presets keep transparency for compositing
// in Canva or an editor; mp4 is the plain upload format for Instagram.
export const PRESETS = {
  mp4: { ext: 'mp4', alpha: false, args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] },
  webm: { ext: 'webm', alpha: true, args: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '22', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0'] },
  prores: { ext: 'mov', alpha: true, args: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'] },
};

// Opens one ffmpeg process reading width×height RGBA frames from stdin.
export function frameWriter({ width, height, fps, out, preset }) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`Unknown video preset ${preset}`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', ...p.args, out], { stdio: ['pipe', 'inherit', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', d => { stderr += d; });
  const done = new Promise((resolve, reject) => {
    ff.on('error', err => reject(err.code === 'ENOENT' ? new Error('ffmpeg is not installed') : err));
    ff.on('close', code => code === 0 ? resolve(out) : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`)));
  });
  return {
    async write(frame) {
      if (frame.length !== width * height * 4) throw new Error('Frame size does not match the video size');
      if (!ff.stdin.write(frame)) await new Promise(r => ff.stdin.once('drain', r));
    },
    end() { ff.stdin.end(); return done; },
  };
}

// Flattens a straight-alpha RGBA frame onto a solid colour, for encoders without alpha.
export function flatten(frame, [r, g, b]) {
  const out = Buffer.allocUnsafe(frame.length);
  for (let i = 0; i < frame.length; i += 4) {
    const a = frame[i + 3] / 255, k = 1 - a;
    out[i] = frame[i] * a + r * k; out[i + 1] = frame[i + 1] * a + g * k; out[i + 2] = frame[i + 2] * a + b * k; out[i + 3] = 255;
  }
  return out;
}
