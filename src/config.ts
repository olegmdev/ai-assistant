import "dotenv/config";

// Trim env values — copy-paste from dashboards often adds a trailing newline or
// space, which silently breaks secrets/signatures.
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return (process.env[name]?.trim() || fallback);
}

// Accept the first of several env var names that is set. Lets us prefer the
// current Supabase naming while staying compatible with the legacy one.
function requiredOneOf(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(
    `Missing required environment variable (set one of: ${names.join(", ")}). Copy .env.example to .env and fill it in.`,
  );
}

// Instagram and Threads are separate products with separate app secrets, and
// Meta signs each platform's webhooks with that platform's secret. We verify an
// incoming signature against whichever secrets are configured.
// Accept the legacy META_APP_SECRET name as a fallback so existing setups keep
// working after the rename.
const instagramAppSecret = requiredOneOf(["INSTAGRAM_APP_SECRET", "META_APP_SECRET"]);
const threadsAppSecret = optional("THREADS_APP_SECRET", "");

// Instagram and Threads each have their own "Verify token" field in the
// dashboard. The GET handshake doesn't say which platform it's for — Meta just
// echoes back whatever token you typed — so we accept any configured token. Set
// the same value for both if you'd rather share one.
const verifyToken = requiredOneOf([
  "WEBHOOK_INSTAGRAM_VERIFY_TOKEN",
  "WEBHOOK_VERIFY_TOKEN",
]);
const threadsVerifyToken = optional("WEBHOOK_THREADS_VERIFY_TOKEN", "");

export const config = {
  port: Number(optional("PORT", "3000")),

  meta: {
    appSecret: instagramAppSecret,
    threadsAppSecret,
    // All non-empty webhook-signing secrets to try when verifying a payload.
    webhookSecrets: [instagramAppSecret, threadsAppSecret].filter(Boolean),
    verifyToken,
    threadsVerifyToken,
    // All configured verify tokens to accept during the GET handshake.
    verifyTokens: [verifyToken, threadsVerifyToken].filter(Boolean),
    graphApiVersion: optional("GRAPH_API_VERSION", "v23.0"),
    instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || "",
    threadsAccessToken: process.env.THREADS_ACCESS_TOKEN?.trim() || "",
  },

  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    // Per the claude-api skill: default to the most capable model.
    model: "claude-opus-4-8",
  },

  // ElevenLabs powers voice notes: Scribe (STT) transcribes inbound voice DMs,
  // TTS speaks the reply. All optional — if the API key is absent, voice DMs
  // fall back to a text reply.
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY?.trim() || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || "",
    // Multilingual so Ukrainian/English replies both sound right.
    ttsModel: optional("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
    sttModel: optional("ELEVENLABS_STT_MODEL", "scribe_v1"),
  },

  // Public base URL of THIS server (e.g. the cloudflared tunnel URL), used to
  // hand Instagram a fetchable URL for the generated voice reply. No trailing
  // slash. Required only for outbound voice; text replies don't need it.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL?.trim() || "").replace(/\/$/, ""),

  supabase: {
    url: required("SUPABASE_URL"),
    // The privileged, server-only key that bypasses RLS. In the current
    // Supabase dashboard this is the "Secret key" (sb_secret_…); on older
    // projects it's the legacy service_role key. Either works.
    secretKey: requiredOneOf(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]),
  },
} as const;

export type Platform = "instagram" | "threads";
