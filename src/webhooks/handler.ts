import type { Platform } from "../config.js";
import { log, serializeError } from "../logger.js";
import type { InboundMessage, WebhookBody } from "../meta/types.js";
import { sendTextMessage, sendAudioMessage } from "../meta/client.js";
import { transcribeAudio, synthesizeSpeech, voiceEnabled } from "../voice/elevenlabs.js";
import { putAudio } from "../voice/audioStore.js";
import {
  getOrCreateConversation,
  recordInboundMessage,
  recordAssistantMessage,
  setConversationStatus,
} from "../db/supabase.js";
import { generateReply } from "../ai/assistant.js";
import { parseControlCommand, type ControlCommand } from "../control.js";

/** Map the webhook `object` field to our Platform type. */
function platformOf(object?: string): Platform | null {
  if (object === "instagram") return "instagram";
  if (object === "threads") return "threads";
  return null;
}

/** Pull normalized inbound DMs out of a raw webhook body. */
export function extractInboundMessages(body: WebhookBody): InboundMessage[] {
  const platform = platformOf(body.object);
  if (!platform) return [];

  const out: InboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const msg = event.message;
      // Skip echoes (our own sends) and empty events.
      if (!msg || msg.is_echo) continue;
      const text = msg.text?.trim();
      const senderId = event.sender?.id;
      const messageId = msg.mid;
      // Voice notes arrive as an audio attachment with a fetchable URL.
      const audioUrl = msg.attachments?.find(
        (a) => a.type === "audio" && a.payload?.url,
      )?.payload?.url;
      if ((!text && !audioUrl) || !senderId || !messageId) continue;

      out.push({
        platform,
        accountId: event.recipient?.id ?? entry.id ?? "",
        senderId,
        messageId,
        text: text ?? "",
        audioUrl,
      });
    }
  }
  return out;
}

/** An owner ("Eve, stop" / "Єва, продовжуй") control command from an echo. */
export interface OwnerCommand {
  platform: Platform;
  // The conversation partner — the recipient of the owner's echoed message.
  userId: string;
  command: ControlCommand;
}

/** Pull owner control commands out of echo messages in a webhook body. */
export function extractOwnerCommands(body: WebhookBody): OwnerCommand[] {
  const platform = platformOf(body.object);
  if (!platform) return [];

  const out: OwnerCommand[] = [];
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const msg = event.message;
      if (!msg?.is_echo) continue; // owner-sent only
      const text = msg.text?.trim();
      const userId = event.recipient?.id;
      if (!text || !userId) continue;

      const command = parseControlCommand(text);
      if (!command) continue;
      out.push({ platform, userId, command });
    }
  }
  return out;
}

/** Apply a pause/resume command to the matching conversation. */
export async function applyOwnerCommand(cmd: OwnerCommand): Promise<void> {
  const convo = await getOrCreateConversation(cmd.platform, cmd.userId);
  const status = cmd.command === "pause" ? "paused" : "active";
  await setConversationStatus(convo.id, status);
  log.info("Owner command applied", {
    conversationId: convo.id,
    platform: cmd.platform,
    command: cmd.command,
  });
}

/** Process one inbound DM end-to-end: persist, think, reply. */
export async function processInboundMessage(msg: InboundMessage): Promise<void> {
  const convo = await getOrCreateConversation(msg.platform, msg.senderId);

  // Voice note: transcribe to text so the rest of the pipeline (storage,
  // history, Claude) works unchanged. A voice DM gets a voice reply.
  const isVoice = Boolean(msg.audioUrl);
  let text = msg.text;
  if (isVoice && msg.audioUrl) {
    const transcript = await transcribeAudio(msg.audioUrl);
    if (!transcript) {
      log.warn("Could not transcribe voice note; skipping", {
        messageId: msg.messageId,
      });
      return;
    }
    text = transcript;
    log.info("Transcribed voice note", { conversationId: convo.id });
  }

  const isNew = await recordInboundMessage(convo.id, msg.messageId, text);
  if (!isNew) {
    log.info("Duplicate delivery ignored", { messageId: msg.messageId });
    return;
  }

  // Bot is paused for this thread — Oleh is handling it. Keep storing messages
  // for context, but don't auto-reply until he resumes ("Єва, продовжуй").
  if (convo.status === "paused") {
    log.info("Conversation paused; skipping auto-reply", {
      conversationId: convo.id,
    });
    return;
  }

  const reply = await generateReply(convo.id, msg.platform);
  if (!reply) return;

  // Voice in → voice out, when ElevenLabs is configured. Fall back to text if
  // synthesis or audio delivery fails for any reason.
  if (isVoice && voiceEnabled()) {
    const sent = await sendVoiceReply(msg.platform, msg.senderId, reply);
    if (!sent) await sendTextMessage(msg.platform, msg.senderId, reply);
  } else {
    await sendTextMessage(msg.platform, msg.senderId, reply);
  }

  // Persist the assistant turn after a successful send.
  await recordAssistantMessage(convo.id, reply);
}

/**
 * Synthesize `text` with ElevenLabs, host the MP3, and send it as a voice DM.
 * Returns false (so the caller can fall back to text) if any step fails.
 */
async function sendVoiceReply(
  platform: Platform,
  recipientId: string,
  text: string,
): Promise<boolean> {
  try {
    const mp3 = await synthesizeSpeech(text);
    if (!mp3) return false;
    const audioUrl = putAudio(mp3);
    if (!audioUrl) {
      log.warn("PUBLIC_BASE_URL not set; cannot host voice reply, using text");
      return false;
    }
    await sendAudioMessage(platform, recipientId, audioUrl);
    return true;
  } catch (err) {
    log.error("Voice reply failed; falling back to text", {
      err: serializeError(err),
    });
    return false;
  }
}

/**
 * Handle a full webhook body: fan out to each inbound message. Errors are
 * logged per-message so one bad event doesn't drop the rest.
 */
export async function handleWebhookBody(body: WebhookBody): Promise<void> {
  // Apply owner commands first so a "stop" in the same batch takes effect
  // before any user message in that batch is processed.
  for (const cmd of extractOwnerCommands(body)) {
    try {
      await applyOwnerCommand(cmd);
    } catch (err) {
      log.error("Failed to apply owner command", {
        userId: cmd.userId,
        err: serializeError(err),
      });
    }
  }

  const messages = extractInboundMessages(body);
  for (const msg of messages) {
    try {
      await processInboundMessage(msg);
    } catch (err) {
      log.error("Failed to process message", {
        messageId: msg.messageId,
        err: serializeError(err),
      });
    }
  }
}
