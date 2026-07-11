import type { Platform } from "../config.js";

// Shape of the Messenger-style webhook payload that Instagram (and Threads,
// for messaging) deliver. We only model the fields we actually read.

export interface WebhookBody {
  object?: string; // "instagram" | "threads"
  entry?: WebhookEntry[];
}

export interface WebhookEntry {
  id?: string;
  time?: number;
  messaging?: MessagingEvent[];
  // Threads/IG also deliver "changes" (comments, mentions). Modeled loosely.
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
}

export interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean; // messages the account itself sent
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
    // Instagram attaches this when the DM is a reply to one of the recipient's
    // stories. `story.id` is the media ID we can look up via the Graph API.
    reply_to?: { story?: { id?: string; url?: string } };
  };
}

// A single inbound DM normalized across platforms.
export interface InboundMessage {
  platform: Platform;
  // The page/account that received the message (recipient id).
  accountId: string;
  // The user who sent it (IGSID / Threads user id).
  senderId: string;
  messageId: string;
  // Transcript for voice notes, or the typed text for text DMs. May be empty at
  // extraction time for voice (filled in after transcription).
  text: string;
  // Set when the DM is a voice note: the URL of the audio attachment to
  // transcribe. When present, the reply is sent back as voice too.
  audioUrl?: string;
  // Set when the DM is a reply to one of the recipient's Instagram stories.
  // The Graph API media ID we can fetch to pull the story's audio + caption.
  storyId?: string;
}
