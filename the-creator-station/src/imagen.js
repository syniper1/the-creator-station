import { z } from 'zod';
import { getVertexClient, getImagenModelId } from './vertex.js';

const ImageReq = z.object({
  prompt: z.string().min(5),
  suffix: z.string().optional().default(''),
  aspect: z.enum(['16:9', '1:1', '9:16']).optional().default('16:9')
});

function aspectToSize(aspect) {
  if (aspect === '1:1') return { width: 1024, height: 1024 };
  if (aspect === '9:16') return { width: 768, height: 1365 };
  return { width: 1280, height: 720 };
}

export async function generateImage(body) {
  const { prompt, suffix, aspect } = ImageReq.parse(body);
  const { vertexAI } = getVertexClient();

  // Imagen on Vertex AI uses a Prediction-style API through the SDK's generative image model helper.
  // The exact model id can vary by region; override VERTEX_IMAGEN_MODEL if needed.
  const model = vertexAI.getGenerativeModel({ model: getImagenModelId() });

  const { width, height } = aspectToSize(aspect);
  const fullPrompt = `${prompt}${suffix ? ' ' + suffix : ''}`.trim();

  // Many Vertex image models accept a "prompt" and image parameters. If your region requires a different request shape,
  // change here without touching the frontend.
  const resp = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({
      prompt: fullPrompt,
      image: { width, height },
      safetySettings: 'default'
    }) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
  });

  // Try to locate base64 image data in the response.
  const parts = resp?.response?.candidates?.[0]?.content?.parts || [];
  const joined = parts.map(p => p.text || '').join('\n');

  // Heuristic: find base64 token that looks like an image.
  // If your Vertex model returns different fields, you can update parsing.
  const b64Match = joined.match(/"data"\s*:\s*"([^"]+)"/) || joined.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!b64Match) {
    // Fallback: return raw text for debugging in UI
    return { ok: false, error: 'No image data found in response. Check model id/region.', raw: joined };
  }
  return { ok: true, imageBase64: b64Match[1] };
}
