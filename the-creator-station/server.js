import express from 'express';
import path from 'path';
import cors from 'cors';
import multer from 'multer';

import { analyzeScript } from './src/analyze.js';
import { generateImage } from './src/imagen.js';
import { generateSpeech } from './src/tts.js';
import { renderMp4 } from './src/render.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// API
app.post('/api/analyze-script', async (req, res) => {
  try {
    const data = await analyzeScript(req.body);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Analyze failed' });
  }
});

app.post('/api/generate-image', async (req, res) => {
  try {
    const data = await generateImage(req.body);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Image failed' });
  }
});

app.post('/api/generate-speech', async (req, res) => {
  try {
    const data = await generateSpeech(req.body);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'TTS failed' });
  }
});

const upload = multer({ dest: '/tmp/uploads' });
app.post('/api/render-video', upload.fields([{ name: 'images', maxCount: 200 }, { name: 'audios', maxCount: 200 }]), async (req, res) => {
  try {
    const manifestJson = req.body.manifest;
    const buf = await renderMp4({ files: req.files, manifestJson });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="creator-station.mp4"');
    res.send(buf);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Render failed' });
  }
});

// Serve frontend
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on ${port}`));
