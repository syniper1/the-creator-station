import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { Wand2, Split, Image as ImageIcon, AudioLines, Film, Download, Sparkles } from 'lucide-react';
import { PRESETS, autoDetectPresetId } from './styles.js';
import { sleep, b64ToBlob, downloadBlob } from './utils.js';

const VOICES = ['Fenrir','Puck','Zephyr','Nova','Default'];

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export default function App() {
  const [script, setScript] = useState('');
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [customStyle, setCustomStyle] = useState(() => {
    try { return JSON.parse(localStorage.getItem('creatorStationCustomStyle') || 'null'); } catch { return null; }
  });
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customSuffix, setCustomSuffix] = useState('');

  const [analysis, setAnalysis] = useState(null);
  const [loadingAnalyze, setLoadingAnalyze] = useState(false);

  const [voice, setVoice] = useState('Default');
  const [genBusy, setGenBusy] = useState(false);

  const [tab, setTab] = useState('images'); // images | voice | video
  const activePreset = useMemo(() => {
    if (presetId === 'custom' && customStyle) {
      return {
        id: 'custom',
        name: customStyle.name,
        target: 'Custom',
        suffix: customStyle.suffix,
        timing: 13,
        accent: '#7C3AED',
        voiceDefault: 'Default'
      };
    }
    return PRESETS.find(p => p.id === presetId) || PRESETS[0];
  }, [presetId, customStyle]);

  useEffect(() => {
    // auto-detect on paste/typing
    const detected = autoDetectPresetId(script);
    setPresetId(prev => (prev === 'custom' ? prev : detected));
  }, [script]);

  useEffect(() => {
    setVoice(activePreset.voiceDefault || 'Default');
    document.documentElement.style.setProperty('--accent', activePreset.accent);
  }, [activePreset]);

  const timingRuleSeconds = activePreset.timing;

  const estimatedCost = useMemo(() => {
    const scenes = analysis?.scenes || [];
    const imageCost = scenes.filter(s => s.imageBase64).length * 0.04;
    const chars = scenes.reduce((sum, s) => sum + (s.narration || '').length, 0);
    const ttsCost = chars * 0.000016;
    return { imageCost, ttsCost, total: imageCost + ttsCost, chars };
  }, [analysis]);

  async function onAnalyze() {
    setLoadingAnalyze(true);
    setAnalysis(null);
    try {
      const res = await axios.post('/api/analyze-script', {
        script,
        styleName: activePreset.name,
        timingRuleSeconds,
        visualPromptSuffix: activePreset.suffix
      });
      if (!res.data.ok) throw new Error(res.data.error || 'Analyze failed');
      const data = res.data.data;
      // Initialize asset fields
      data.scenes = (data.scenes || []).map(s => ({
        ...s,
        imageBase64: '',
        audioBase64: '',
        imagePromptFinal: ''
      }));
      setAnalysis(data);
    } catch (e) {
      alert(e.message || 'Analyze failed');
    } finally {
      setLoadingAnalyze(false);
    }
  }

  async function generateAllImages() {
    if (!analysis) return;
    setGenBusy(true);
    try {
      const updated = { ...analysis, scenes: [...analysis.scenes] };
      for (let i = 0; i < updated.scenes.length; i++) {
        const s = updated.scenes[i];
        const prompt = (s.image_prompt || '').trim();
        if (!prompt) continue;
        const suffix = activePreset.suffix || '';
        const res = await axios.post('/api/generate-image', {
          prompt,
          suffix,
          aspect: '16:9'
        });
        if (!res.data.ok) {
          console.warn('Image error', res.data);
          s.imagePromptFinal = prompt + ' ' + suffix;
          s.imageBase64 = '';
        } else {
          s.imagePromptFinal = prompt + ' ' + suffix;
          s.imageBase64 = res.data.imageBase64;
        }
        setAnalysis({ ...updated });
        await sleep(2000); // rate limit: 1 image / 2 seconds
      }
    } catch (e) {
      alert(e.message || 'Image generation failed');
    } finally {
      setGenBusy(false);
      setTab('images');
    }
  }

  async function generateAllAudio() {
    if (!analysis) return;
    setGenBusy(true);
    try {
      const updated = { ...analysis, scenes: [...analysis.scenes] };
      for (let i = 0; i < updated.scenes.length; i++) {
        const s = updated.scenes[i];
        const text = (s.narration || '').trim();
        if (!text) continue;
        const res = await axios.post('/api/generate-speech', {
          text,
          voice,
          speakingRate: presetId === 'productivity-sketch' ? 1.15 : 1.0
        });
        if (res.data.ok) s.audioBase64 = res.data.audioBase64;
        setAnalysis({ ...updated });
        await sleep(250);
      }
    } catch (e) {
      alert(e.message || 'Audio generation failed');
    } finally {
      setGenBusy(false);
      setTab('voice');
    }
  }

  function sceneRows() {
    const scenes = analysis?.scenes || [];
    return scenes.map(s => ({
      scene_id: s.scene_id,
      duration_sec: s.duration_sec,
      narration: s.narration,
      on_screen_text: s.on_screen_text,
      image_prompt: s.image_prompt,
      image_prompt_final: s.imagePromptFinal || '',
      has_image: !!s.imageBase64,
      has_audio: !!s.audioBase64,
    }));
  }

  async function downloadZip() {
    if (!analysis) return;
    const zip = new JSZip();

    // manifest.csv
    const csv = Papa.unparse(sceneRows());
    zip.file('manifest.csv', csv);

    // script + analysis
    zip.file('script.txt', script || '');
    zip.file('analysis.json', JSON.stringify(analysis, null, 2));

    // assets
    const scenes = analysis.scenes || [];
    for (const s of scenes) {
      const id = String(s.scene_id).padStart(2,'0');
      if (s.imageBase64) {
        zip.file(`images/scene_${id}.png`, b64ToBlob(s.imageBase64, 'image/png'));
      }
      if (s.audioBase64) {
        zip.file(`audio/scene_${id}.mp3`, b64ToBlob(s.audioBase64, 'audio/mpeg'));
      }
      zip.file(`prompts/scene_${id}.txt`, (s.imagePromptFinal || s.image_prompt || '').trim());
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'creator-station-assets.zip');
  }

  async function exportMp4() {
    if (!analysis) return;
    const scenes = analysis.scenes || [];
    const images = scenes.filter(s => s.imageBase64);
    if (images.length !== scenes.length) {
      alert('Generate all images first (MP4 needs one image per scene).');
      return;
    }

    // Build multipart form
    const form = new FormData();
    const manifest = { scenes: scenes.map(s => ({ duration_sec: clamp(Number(s.duration_sec||timingRuleSeconds),1,60), hasAudio: !!s.audioBase64 })) };
    form.append('manifest', JSON.stringify(manifest));

    for (let i=0;i<scenes.length;i++){
      const s = scenes[i];
      const imgBlob = b64ToBlob(s.imageBase64, 'image/png');
      form.append('images', imgBlob, `scene_${String(i).padStart(3,'0')}.png`);
      if (s.audioBase64) {
        const audBlob = b64ToBlob(s.audioBase64, 'audio/mpeg');
        form.append('audios', audBlob, `scene_${String(i).padStart(3,'0')}.mp3`);
      } else {
        // still keep order: add empty audio? backend tolerates missing but order can shift if some missing.
        // We'll append a tiny silent mp3 is not trivial here; better: require audio for all scenes OR none.
      }
    }

    try {
      setGenBusy(true);
      const res = await axios.post('/api/render-video', form, { responseType: 'blob' });
      downloadBlob(res.data, 'creator-station.mp4');
    } catch (e) {
      alert('MP4 export failed. Tip: generate audio for ALL scenes before exporting.');
    } finally {
      setGenBusy(false);
    }
  }

  function saveCustom() {
    const obj = { name: customName.trim() || 'Custom Style', suffix: customSuffix.trim() || '' };
    localStorage.setItem('creatorStationCustomStyle', JSON.stringify(obj));
    setCustomStyle(obj);
    setPresetId('custom');
    setShowCustom(false);
  }

  const accent = activePreset.accent;

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl flex items-center justify-center"
                 style={{ backgroundColor: accent + '22', border: `1px solid ${accent}55` }}>
              <Sparkles size={20} style={{ color: accent }} />
            </div>
            <div>
              <div className="text-lg font-semibold">The Creator Station</div>
              <div className="text-xs text-white/60">Universal Video Production Engine</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <select
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm"
              value={presetId}
              onChange={(e)=>setPresetId(e.target.value)}
            >
              {PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              {customStyle ? <option value="custom">{customStyle.name}</option> : <option value="custom">Custom Style</option>}
            </select>

            <button
              className="rounded-xl px-3 py-2 text-sm border border-white/10 bg-white/5 hover:bg-white/10"
              onClick={()=>setShowCustom(true)}
            >
              Manage Style
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Step 1 */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Wand2 size={18} style={{ color: accent }} />
            <h2 className="font-semibold">Step 1: Script & Analysis</h2>
          </div>

          <div className="text-xs text-white/70 mb-3">
            Auto-timing rule: <span className="font-semibold" style={{ color: accent }}>{timingRuleSeconds}s max</span> per scene • Target: {activePreset.target}
          </div>

          <textarea
            className="w-full h-56 rounded-2xl bg-black/40 border border-white/10 p-4 text-sm outline-none focus:border-white/30"
            placeholder="Paste your script here..."
            value={script}
            onChange={(e)=>setScript(e.target.value)}
          />

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={onAnalyze}
              disabled={loadingAnalyze || !script.trim()}
              className="rounded-2xl px-4 py-2 text-sm font-semibold"
              style={{ backgroundColor: accent, color: '#000' }}
            >
              {loadingAnalyze ? 'Analyzing...' : 'ANALYZE & AUTO-SPLIT'}
            </button>

            <div className="text-xs text-white/60 flex items-center gap-2">
              <Split size={16} />
              Auto-select style from keywords (focus/productivity/god)
            </div>
          </div>

          {analysis && (
            <div className="mt-4 text-sm text-white/80">
              <div className="font-semibold">{analysis.title || 'Untitled'}</div>
              <div className="text-xs text-white/60 mt-1">{analysis.summary || ''}</div>
              <div className="mt-3 text-xs text-white/60">
                Scenes: <span className="text-white">{analysis.scenes?.length || 0}</span>
              </div>
            </div>
          )}
        </section>

        {/* Step 2 */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon size={18} style={{ color: accent }} />
            <h2 className="font-semibold">Step 2: Asset Generation Studio</h2>
          </div>

          <div className="flex gap-2 mb-4">
            <button onClick={()=>setTab('images')} className={`px-3 py-2 rounded-xl text-sm border ${tab==='images'?'bg-white/10 border-white/20':'bg-transparent border-white/10'}`}>Images</button>
            <button onClick={()=>setTab('voice')} className={`px-3 py-2 rounded-xl text-sm border ${tab==='voice'?'bg-white/10 border-white/20':'bg-transparent border-white/10'}`}>Voice</button>
            <button onClick={()=>setTab('video')} className={`px-3 py-2 rounded-xl text-sm border ${tab==='video'?'bg-white/10 border-white/20':'bg-transparent border-white/10'}`}>Video</button>
          </div>

          {!analysis && <div className="text-sm text-white/60">Run Step 1 first.</div>}

          {analysis && tab === 'images' && (
            <div>
              <div className="text-xs text-white/60 mb-3">
                Visual suffix applied automatically: <span className="text-white/80">{activePreset.suffix.slice(0, 70)}{activePreset.suffix.length>70?'…':''}</span>
              </div>

              <button
                onClick={generateAllImages}
                disabled={genBusy}
                className="rounded-2xl px-4 py-2 text-sm font-semibold flex items-center gap-2"
                style={{ backgroundColor: accent, color: '#000' }}
              >
                <ImageIcon size={16} /> {genBusy ? 'Generating...' : 'Generate All Images'}
              </button>

              <div className="mt-4 grid grid-cols-2 gap-3 max-h-80 overflow-auto pr-2">
                {(analysis.scenes || []).map((s) => (
                  <div key={s.scene_id} className="rounded-2xl border border-white/10 bg-black/30 p-2">
                    <div className="text-xs text-white/70 mb-2">Scene {s.scene_id}</div>
                    {s.imageBase64 ? (
                      <img className="w-full rounded-xl kb" src={`data:image/png;base64,${s.imageBase64}`} />
                    ) : (
                      <div className="h-28 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xs text-white/50">
                        No image yet
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis && tab === 'voice' && (
            <div>
              <div className="flex items-center gap-3">
                <div className="text-sm">Voice</div>
                <select
                  className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm"
                  value={voice}
                  onChange={(e)=>setVoice(e.target.value)}
                >
                  {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <button
                onClick={generateAllAudio}
                disabled={genBusy}
                className="mt-3 rounded-2xl px-4 py-2 text-sm font-semibold flex items-center gap-2"
                style={{ backgroundColor: accent, color: '#000' }}
              >
                <AudioLines size={16} /> {genBusy ? 'Generating...' : 'Generate All Audio'}
              </button>

              <div className="mt-4 space-y-3 max-h-80 overflow-auto pr-2">
                {(analysis.scenes || []).map((s) => (
                  <div key={s.scene_id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-white/70">Scene {s.scene_id}</div>
                      {s.audioBase64 ? <span className="text-xs text-green-400">audio ready</span> : <span className="text-xs text-white/40">no audio</span>}
                    </div>
                    <div className="text-sm mt-2 text-white/85">{s.narration}</div>
                    {s.audioBase64 && (
                      <audio className="mt-2 w-full" controls src={`data:audio/mpeg;base64,${s.audioBase64}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis && tab === 'video' && (
            <div>
              <div className="text-xs text-white/60">
                Preview uses a Ken Burns CSS effect. MP4 export runs ffmpeg on the server.
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
                <button
                  onClick={exportMp4}
                  disabled={genBusy}
                  className="rounded-2xl px-4 py-2 text-sm font-semibold flex items-center gap-2"
                  style={{ backgroundColor: accent, color: '#000' }}
                >
                  <Film size={16} /> {genBusy ? 'Rendering...' : 'Export MP4'}
                </button>
                <div className="text-xs text-white/60 mt-2">
                  Tip: Generate images + audio for all scenes before exporting.
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 max-h-80 overflow-auto pr-2">
                {(analysis.scenes || []).map((s) => (
                  <div key={s.scene_id} className="rounded-2xl border border-white/10 bg-black/30 p-2">
                    <div className="text-xs text-white/70 mb-2">Scene {s.scene_id}</div>
                    {s.imageBase64 ? (
                      <img className="w-full rounded-xl kb" src={`data:image/png;base64,${s.imageBase64}`} />
                    ) : (
                      <div className="h-28 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xs text-white/50">
                        Generate images to preview
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Step 3 */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Download size={18} style={{ color: accent }} />
            <h2 className="font-semibold">Step 3: Export & Cost</h2>
          </div>

          <div className="flex flex-wrap gap-3 items-center justify-between">
            <button
              onClick={downloadZip}
              disabled={!analysis}
              className="rounded-2xl px-4 py-2 text-sm font-semibold flex items-center gap-2"
              style={{ backgroundColor: accent, color: '#000' }}
            >
              <Download size={16} /> Download ZIP (assets + CSV)
            </button>

            <div className="text-sm text-white/70">
              <span className="text-white/60">Est. cost:</span>{' '}
              <span className="font-semibold" style={{ color: accent }}>${estimatedCost.total.toFixed(3)}</span>
              <span className="text-white/50"> (images ${estimatedCost.imageCost.toFixed(2)} + TTS ${estimatedCost.ttsCost.toFixed(3)}; {estimatedCost.chars} chars)</span>
            </div>
          </div>

          {analysis && (
            <div className="mt-4 overflow-auto">
              <table className="w-full text-xs border border-white/10 rounded-2xl overflow-hidden">
                <thead className="bg-white/5">
                  <tr>
                    <th className="text-left p-2">Scene</th>
                    <th className="text-left p-2">Sec</th>
                    <th className="text-left p-2">Narration</th>
                    <th className="text-left p-2">Image</th>
                    <th className="text-left p-2">Audio</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysis.scenes || []).map(s => (
                    <tr key={s.scene_id} className="border-t border-white/10">
                      <td className="p-2">#{s.scene_id}</td>
                      <td className="p-2">{s.duration_sec}</td>
                      <td className="p-2 text-white/80">{(s.narration||'').slice(0,80)}{(s.narration||'').length>80?'…':''}</td>
                      <td className="p-2">{s.imageBase64 ? '✅' : '—'}</td>
                      <td className="p-2">{s.audioBase64 ? '✅' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Custom style modal */}
      {showCustom && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-black p-5">
            <div className="text-lg font-semibold mb-2">Custom Style</div>
            <div className="text-xs text-white/60 mb-4">
              Add a style name + visual prompt suffix. Saved in your browser (localStorage).
            </div>

            <label className="text-xs text-white/70">Style Name</label>
            <input
              className="w-full mt-1 mb-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm"
              value={customName}
              onChange={(e)=>setCustomName(e.target.value)}
              placeholder="e.g., Neon Noir"
            />

            <label className="text-xs text-white/70">Visual Prompt Suffix</label>
            <textarea
              className="w-full mt-1 rounded-xl bg-white/5 border border-white/10 p-3 text-sm h-28"
              value={customSuffix}
              onChange={(e)=>setCustomSuffix(e.target.value)}
              placeholder='e.g., ", cyberpunk ink sketch, rain, neon reflections..."'
            />

            <div className="mt-4 flex gap-2 justify-end">
              <button
                className="rounded-xl px-3 py-2 text-sm border border-white/10 bg-white/5 hover:bg-white/10"
                onClick={()=>setShowCustom(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-xl px-3 py-2 text-sm font-semibold"
                style={{ backgroundColor: accent, color: '#000' }}
                onClick={saveCustom}
              >
                Save
              </button>
            </div>

            {customStyle && (
              <div className="mt-3 text-xs text-white/60">
                Current saved: <span className="text-white/80">{customStyle.name}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="py-8 text-center text-xs text-white/40">
        Built for Cloud Run • Vertex AI on the backend • Accent: <span style={{ color: accent }}>{accent}</span>
      </footer>
    </div>
  );
}
