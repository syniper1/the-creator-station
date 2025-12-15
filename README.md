# The Creator Station (Universal Video Production Engine)

Production-ready React + Node.js app designed for Google Cloud Run.
- Frontend: React (Vite) + Tailwind + lucide-react
- Backend: Node/Express calling Vertex AI (Gemini/Imagen) securely
- TTS: Google Cloud Text-to-Speech (safe default). You can swap to a Gemini TTS endpoint later if/when available in your Vertex region.
- Deploy: Dockerfile + cloudbuild.yaml

## Quick start (local)
1. Copy `.env.example` to `.env` and fill `GCP_PROJECT_ID` / `GCP_LOCATION`.
2. Install deps:
   ```bash
   npm i
   npm --prefix client i
   ```
3. Run client:
   ```bash
   npm --prefix client run dev
   ```
4. Run server:
   ```bash
   npm run dev
   ```

## Deploy to Cloud Run (recommended)
This repo includes `cloudbuild.yaml` for Cloud Build.

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud builds submit --config cloudbuild.yaml
```

After deploy, Cloud Build prints the Cloud Run URL.

## Notes
- Image generation is rate-limited client-side to 1 image every 2 seconds.
- Video rendering uses ffmpeg inside Cloud Run. It can take time for large projects.
