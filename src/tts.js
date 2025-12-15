import { z } from 'zod';
import textToSpeech from '@google-cloud/text-to-speech';

const TTSReq = z.object({
  text: z.string().min(1),
  voice: z.enum(['Fenrir','Puck','Zephyr','Nova','Default']).optional().default('Default'),
  speakingRate: z.number().min(0.7).max(1.3).optional().default(1.0)
});

const VOICE_MAP = {
  Default: { languageCode: 'en-US', name: 'en-US-Neural2-D' },
  Fenrir: { languageCode: 'en-US', name: 'en-US-Neural2-D' }, // deep male-ish
  Puck:   { languageCode: 'en-US', name: 'en-US-Neural2-A' }, // crisp male-ish
  Zephyr: { languageCode: 'en-US', name: 'en-US-Neural2-F' }, // female-ish
  Nova:   { languageCode: 'en-US', name: 'en-US-Neural2-C' },
};

export async function generateSpeech(body) {
  if (process.env.DISABLE_TTS === '1') {
    return { ok: false, error: 'TTS disabled by server env var DISABLE_TTS=1' };
  }
  const { text, voice, speakingRate } = TTSReq.parse(body);

  const client = new textToSpeech.TextToSpeechClient();
  const v = VOICE_MAP[voice] || VOICE_MAP.Default;

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: v.languageCode, name: v.name },
    audioConfig: { audioEncoding: 'MP3', speakingRate }
  });

  const audioContent = response.audioContent;
  if (!audioContent) return { ok: false, error: 'No audio generated.' };

  const b64 = Buffer.isBuffer(audioContent) ? audioContent.toString('base64') : Buffer.from(audioContent).toString('base64');
  return { ok: true, audioBase64: b64, mime: 'audio/mpeg' };
}
