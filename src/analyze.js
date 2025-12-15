import { z } from 'zod';
import { getVertexClient, getGeminiModelId } from './vertex.js';

const AnalyzeReq = z.object({
  script: z.string().min(10),
  styleName: z.string().optional(),
  timingRuleSeconds: z.number().int().min(4).max(30).default(13),
  visualPromptSuffix: z.string().optional().default(''),
});

export async function analyzeScript(body) {
  const { script, styleName, timingRuleSeconds, visualPromptSuffix } = AnalyzeReq.parse(body);

  const { vertexAI } = getVertexClient();
  const model = vertexAI.getGenerativeModel({ model: getGeminiModelId() });

  const system = `
You are a YouTube production assistant. Convert the user's script into a scene plan.

Output STRICT JSON ONLY with this schema:
{
  "title": string,
  "summary": string,
  "scenes": [
    {
      "scene_id": number,
      "duration_sec": number, // <= TIMING_RULE_SECONDS
      "narration": string,
      "on_screen_text": string,
      "image_prompt": string, // MUST describe the scene visually
      "keywords": string[]
    }
  ]
}

Rules:
- Split into scenes so each scene duration is <= TIMING_RULE_SECONDS.
- Keep narration short and punchy for each scene.
- image_prompt MUST NOT include the visual suffix. The server will append it later.
- Avoid markdown, avoid commentary, JSON only.
`.trim();

  const prompt = `
STYLE_NAME: ${styleName || 'Unknown'}
TIMING_RULE_SECONDS: ${timingRuleSeconds}

SCRIPT:
${script}
`.trim();

  const resp = await model.generateContent({
    contents: [
      { role: 'user', parts: [{ text: system }, { text: prompt }] }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048
    }
  });

  const text = resp?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  // Extract JSON even if model adds stray text.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Model did not return JSON.');
  const jsonStr = text.slice(start, end + 1);

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Failed to parse model JSON. Try again.');
  }

  // Enforce timing rule and append suffix later in image generation
  if (Array.isArray(data.scenes)) {
    data.scenes = data.scenes.map((s, idx) => ({
      scene_id: Number(s.scene_id ?? (idx + 1)),
      duration_sec: Math.min(Number(s.duration_sec ?? timingRuleSeconds), timingRuleSeconds),
      narration: String(s.narration ?? ''),
      on_screen_text: String(s.on_screen_text ?? ''),
      image_prompt: String(s.image_prompt ?? ''),
      keywords: Array.isArray(s.keywords) ? s.keywords.map(String).slice(0, 12) : []
    }));
  }

  return data;
}
