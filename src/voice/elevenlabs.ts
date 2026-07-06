import { config } from "../config.js";
import { log } from "../logger.js";

const API = "https://api.elevenlabs.io/v1";

/** Whether voice features are usable (API key + a voice configured). */
export function voiceEnabled(): boolean {
  return Boolean(config.elevenlabs.apiKey && config.elevenlabs.voiceId);
}

/**
 * Transcribe an inbound voice note. Downloads the audio from the Instagram CDN
 * URL, then sends it to ElevenLabs Scribe (speech-to-text). Returns the
 * transcript, or null if transcription isn't possible.
 */
export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  if (!config.elevenlabs.apiKey) {
    log.warn("ELEVENLABS_API_KEY not set; cannot transcribe voice note");
    return null;
  }

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    log.error("Failed to download inbound audio", { status: audioRes.status });
    return null;
  }
  const audio = await audioRes.blob();

  const form = new FormData();
  form.append("model_id", config.elevenlabs.sttModel);
  form.append("file", audio, "voice-note");

  const res = await fetch(`${API}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": config.elevenlabs.apiKey },
    body: form,
  });

  if (!res.ok) {
    log.error("ElevenLabs STT failed", {
      status: res.status,
      detail: await res.text(),
    });
    return null;
  }

  const data = (await res.json()) as { text?: string };
  const text = data.text?.trim();
  return text || null;
}

// Instagram's DM send only accepts WAV or M4A for audio (MP3/AAC/OGG are
// rejected with "format not supported"). ElevenLabs can't emit either directly,
// but it can emit raw PCM, which we wrap in a WAV container ourselves — no
// transcoder/ffmpeg needed. 24 kHz mono is plenty for a voice note.
const PCM_SAMPLE_RATE = 24000;

/** Wrap raw 16-bit mono little-endian PCM in a minimal WAV (RIFF) header. */
function pcmToWav(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Synthesize speech for a reply. Returns WAV bytes (Instagram-compatible), or
 * null on failure.
 */
export async function synthesizeSpeech(
  text: string,
  sampleRate: number = PCM_SAMPLE_RATE,
): Promise<Buffer | null> {
  if (!voiceEnabled()) {
    log.warn("ElevenLabs voice not configured; cannot synthesize reply");
    return null;
  }

  const res = await fetch(
    `${API}/text-to-speech/${config.elevenlabs.voiceId}?output_format=pcm_${sampleRate}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenlabs.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: config.elevenlabs.ttsModel,
      }),
    },
  );

  if (!res.ok) {
    log.error("ElevenLabs TTS failed", {
      status: res.status,
      detail: await res.text(),
    });
    return null;
  }

  return pcmToWav(Buffer.from(await res.arrayBuffer()), sampleRate);
}
