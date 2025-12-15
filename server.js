/**
 * server.js — Creator Station backend (Cloud Run ready)
 *
 * Fixes the common "400 Bad Request" on /api/analyze-script by:
 *  - enabling JSON/body parsing (express.json + urlencoded)
 *  - accepting both {script} and {text} payloads
 *  - logging useful details when the body is missing
 *
 * AI:
 *  - If GOOGLE_API_KEY is set, uses @google/generative-ai (Gemini API Key)
 *  - Otherwise, uses Application Default Credentials (Cloud Run) to call Vertex AI REST
 */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { GoogleAuth } from "google-auth-library";

// Optional: only used if GOOGLE_API_KEY is provided
let GoogleGenerativeAI = null;
try {
  // dynamic import so deployment doesn't fail if package isn't installed
  const mod = await import("@google/generative-ai");
  GoogleGenerativeAI = mod.GoogleGenerativeAI;
} catch (e) {
  // ok – we can still use ADC/Vertex REST
}

const app = express();

/** ====== IMPORTANT: body parsers (this is the "400 fix") ====== */
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

/** CORS (safe default). If you want to restrict later, set ALLOWED_ORIGIN */
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(
  cors({
    origin: allowedOrigin,
    credentials: false,
  })
);

/** Small request logger for /api */
app.use("/api", (req, res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl} content-type=${req.headers["content-type"] || ""}`);
  next();
});

/** Env */
const PORT = process.env.PORT || 8080;
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";
const GCP_LOCATION = process.env.GCP_LOCATION || process.env.GOOGLE_CLOUD_REGION || "us-central1";

/** Models (edit if needed) */
const MODEL_ANALYZE = process.env.MODEL_ANALYZE || "gemini-1.5-flash-002"; // Vertex model id
const MODEL_IMAGE = process.env.MODEL_IMAGE || "imagen-3.0-generate-001";
const MODEL_TTS = process.env.MODEL_TTS || "gemini-2.5-flash-preview-tts";

/** Health check */
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

/** ====== API: Analyze Script ====== */
app.post("/api/analyze-script", async (req, res) => {
  try {
    // Accept both {script: "..."} and {text: "..."} to be forgiving
    const script = req.body?.script ?? req.body?.text ?? "";

    if (!script || String(script).trim().length === 0) {
      console.log("Analyze error: empty script body. req.body=", req.body);
      return res.status(400).json({ error: "Script is empty. Send JSON: { script: '...' }" });
    }

    // If you just want to confirm body parsing works, set ANALYZE_DRY_RUN=true
    if (process.env.ANALYZE_DRY_RUN === "true") {
      return res.json({
        ok: true,
        dryRun: true,
        receivedChars: String(script).length,
        message: "Body parsing works. Turn off ANALYZE_DRY_RUN to call Gemini.",
      });
    }

    const prompt = [
      "You are a YouTube production assistant.",
      "Analyze the script and return:",
      "1) a short summary",
      "2) suggested scenes split by timing rules (assume 8–13 seconds max per scene)",
      "3) for each scene: scene title + narration text + image prompt",
      "",
      "SCRIPT:",
      String(script),
    ].join("\n");

    const outputText = await generateText(prompt);

    return res.json({ ok: true, result: outputText });
  } catch (err) {
    console.error("Analyze exception:", err);
    // Return a helpful error without leaking secrets
    return res.status(500).json({ error: "Analyze failed. Check Cloud Run logs for details." });
  }
});

/** ====== API: Generate Image (placeholder) ====== */
app.post("/api/generate-image", async (req, res) => {
  // This endpoint depends on your chosen Imagen call method.
  // Keep it simple for now: validate input and respond with a clear message.
  const prompt = req.body?.prompt ?? "";
  if (!prompt || String(prompt).trim().length === 0) {
    return res.status(400).json({ error: "Prompt is empty. Send JSON: { prompt: '...' }" });
  }
  return res.status(501).json({
    error: "Image generation not wired in this server.js template. (Your deployment is OK.)",
    model: MODEL_IMAGE,
    receivedPromptChars: String(prompt).length,
  });
});

/** ====== API: Generate Speech (placeholder) ====== */
app.post("/api/generate-speech", async (req, res) => {
  const text = req.body?.text ?? "";
  if (!text || String(text).trim().length === 0) {
    return res.status(400).json({ error: "Text is empty. Send JSON: { text: '...' }" });
  }
  return res.status(501).json({
    error: "TTS not wired in this server.js template. (Your deployment is OK.)",
    model: MODEL_TTS,
    receivedTextChars: String(text).length,
  });
});

/** ====== Static frontend serving (Vite build output) ====== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If you build the client into /app/client/dist (common), serve it:
const distPath = path.join(__dirname, "client", "dist");
app.use(express.static(distPath));

// SPA fallback (React Router safe)
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

/** ====== Gemini text generation helper ====== */
async function generateText(prompt) {
  // 1) If GOOGLE_API_KEY is present, use Gemini API key via @google/generative-ai
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey && GoogleGenerativeAI) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_API_MODEL || "gemini-1.5-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const resp = await model.generateContent(prompt);
    const text = resp?.response?.text?.() ?? "";
    if (!text) throw new Error("Empty response from Gemini API key flow.");
    return text;
  }

  // 2) Otherwise use ADC to call Vertex AI REST
  if (!GCP_PROJECT_ID) {
    throw new Error("Missing GCP_PROJECT_ID. Set it in Cloud Run Variables & secrets.");
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const accessToken = tokenResp?.token;
  if (!accessToken) {
    throw new Error("Could not obtain access token via ADC.");
  }

  const url =
    `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(
      GCP_PROJECT_ID
    )}/locations/${encodeURIComponent(GCP_LOCATION)}/publishers/google/models/${encodeURIComponent(
      MODEL_ANALYZE
    )}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048,
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    console.error("Vertex AI error status:", r.status, "body:", json);
    throw new Error(`Vertex AI returned ${r.status}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";

  if (!text) {
    console.error("Vertex AI response (no text):", json);
    throw new Error("Vertex AI response did not include text.");
  }

  return text;
}

app.listen(PORT, () => {
  console.log(`✅ Creator Station server listening on port ${PORT}`);
  console.log(`Project=${GCP_PROJECT_ID || "(unset)"} Location=${GCP_LOCATION}`);
});
