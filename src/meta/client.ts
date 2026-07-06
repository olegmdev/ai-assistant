import { config, type Platform } from "../config.js";
import { log } from "../logger.js";

// Instagram messaging is served from graph.instagram.com; Threads from
// graph.threads.net. Both accept the Messenger-style send shape for DMs.
const BASE_URL: Record<Platform, string> = {
  instagram: "https://graph.instagram.com",
  threads: "https://graph.threads.net",
};

function tokenFor(platform: Platform): string {
  return platform === "instagram"
    ? config.meta.instagramAccessToken
    : config.meta.threadsAccessToken;
}

/**
 * Send a text DM reply to a user.
 *
 * Instagram: POST /{version}/me/messages with recipient {id} + message {text}.
 * Threads:   same shape on graph.threads.net once the account has the messaging
 *            permission granted. If your Threads app only has comment/mention
 *            webhooks (no DM send), this call will return a permissions error —
 *            that's expected until Threads DM send is enabled for the account.
 */
export async function sendTextMessage(
  platform: Platform,
  recipientId: string,
  text: string,
): Promise<void> {
  const token = tokenFor(platform);
  if (!token) {
    log.warn("No access token configured; skipping send", { platform });
    return;
  }

  const url = `${BASE_URL[platform]}/${config.meta.graphApiVersion}/me/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    log.error("Failed to send message", { platform, status: res.status, detail });
    throw new Error(`send failed (${res.status}): ${detail}`);
  }

  log.info("Sent reply", { platform, recipientId });
}

/**
 * Send an audio (voice) DM. Instagram fetches the audio from `audioUrl`, so it
 * must be publicly reachable. Same Messenger-style shape as text, with an audio
 * attachment payload instead of a text body.
 */
export async function sendAudioMessage(
  platform: Platform,
  recipientId: string,
  audioUrl: string,
): Promise<void> {
  const token = tokenFor(platform);
  if (!token) {
    log.warn("No access token configured; skipping audio send", { platform });
    return;
  }

  const url = `${BASE_URL[platform]}/${config.meta.graphApiVersion}/me/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { attachment: { type: "audio", payload: { url: audioUrl } } },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    log.error("Failed to send audio message", {
      platform,
      status: res.status,
      detail,
    });
    throw new Error(`audio send failed (${res.status}): ${detail}`);
  }

  log.info("Sent voice reply", { platform, recipientId });
}
