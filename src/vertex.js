import { VertexAI } from '@google-cloud/vertexai';

export function getVertexClient() {
  const project = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GCP_LOCATION || 'us-central1';
  if (!project) {
    throw new Error('Missing GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT). Set it as an env var.');
  }
  return { vertexAI: new VertexAI({ project, location }), project, location };
}

export function getGeminiModelId() {
  return process.env.VERTEX_GEMINI_MODEL || 'gemini-1.5-flash-002';
}

export function getImagenModelId() {
  return process.env.VERTEX_IMAGEN_MODEL || 'imagen-3.0-generate-001';
}
