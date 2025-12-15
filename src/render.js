import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { z } from 'zod';

// This renderer expects multipart uploads:
// - images[] (png/jpg)
// - audios[] (mp3) optional per scene
// - manifest (json) describing durations in seconds matching images order
const Manifest = z.object({
  scenes: z.array(z.object({
    duration_sec: z.number().min(1).max(60),
    hasAudio: z.boolean().optional().default(false)
  })).min(1)
});

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let stderr = '';
    p.stderr.on('data', d => stderr += d.toString());
    p.on('close', code => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`ffmpeg failed (${code}): ${stderr}`));
    });
  });
}

export async function renderMp4({ files, manifestJson }) {
  const manifest = Manifest.parse(JSON.parse(manifestJson));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-station-'));
  const imgDir = path.join(tmp, 'imgs');
  const audDir = path.join(tmp, 'aud');
  fs.mkdirSync(imgDir);
  fs.mkdirSync(audDir);

  // Place files in order
  const images = (files.images || []).sort((a,b)=>a.originalname.localeCompare(b.originalname));
  const audios = (files.audios || []).sort((a,b)=>a.originalname.localeCompare(b.originalname));

  if (images.length !== manifest.scenes.length) {
    throw new Error(`Images count (${images.length}) must match scenes (${manifest.scenes.length}).`);
  }

  const segmentFiles = [];

  for (let i = 0; i < manifest.scenes.length; i++) {
    const dur = manifest.scenes[i].duration_sec;
    const imgPath = images[i].path;
    const seg = path.join(tmp, `seg_${String(i).padStart(3,'0')}.mp4`);

    // Optional audio
    const audioFile = audios[i] ? audios[i].path : null;

    // Build segment: loop image for duration, add audio if exists
    const args = audioFile ? [
      '-y',
      '-loop', '1',
      '-i', imgPath,
      '-i', audioFile,
      '-t', String(dur),
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
      '-shortest',
      '-r', '30',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      seg
    ] : [
      '-y',
      '-loop', '1',
      '-i', imgPath,
      '-t', String(dur),
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
      '-r', '30',
      '-c:v', 'libx264',
      seg
    ];

    await run('ffmpeg', args, tmp);
    segmentFiles.push(seg);
  }

  // concat segments
  const listFile = path.join(tmp, 'list.txt');
  fs.writeFileSync(listFile, segmentFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

  const out = path.join(tmp, 'output.mp4');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out], tmp);

  const buf = fs.readFileSync(out);

  // cleanup
  try {
    for (const f of [...images, ...audios]) { fs.unlinkSync(f.path); }
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}

  return buf;
}
