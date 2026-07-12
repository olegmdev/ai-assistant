import Anthropic from "@anthropic-ai/sdk";
import { config, type Platform } from "../config.js";
import { log, serializeError } from "../logger.js";
import { transcribeAudio } from "../voice/elevenlabs.js";

const vision = new Anthropic({ apiKey: config.anthropic.apiKey });

// Small, fast model for OCR / short image descriptions. The main reply still
// uses the configured assistant model.
const VISION_MODEL = "claude-haiku-4-5-20251001";

interface StoryMedia {
  mediaType?: string; // "VIDEO" | "IMAGE" | "CAROUSEL_ALBUM"
  mediaUrl?: string; // signed CDN URL
  caption?: string;
  timestamp?: string; // ISO 8601
}

/**
 * Fetch a story media object by ID. Only Instagram — Threads has no stories.
 * Returns null if the platform is Threads, the token is missing, or the story
 * is unreachable (expired, permissions, deleted). Stories live 24h.
 */
async function fetchStoryMedia(
  platform: Platform,
  storyId: string,
): Promise<StoryMedia | null> {
  if (platform !== "instagram") return null;
  const token = config.meta.instagramAccessToken;
  if (!token) {
    log.warn("No Instagram access token; cannot fetch story context");
    return null;
  }

  const fields = "media_type,media_url,caption,timestamp";
  const url = `https://graph.instagram.com/${config.meta.graphApiVersion}/${storyId}?fields=${fields}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    log.warn("Failed to fetch story media", {
      storyId,
      status: res.status,
      detail: await res.text().catch(() => ""),
    });
    return null;
  }
  const data = (await res.json()) as {
    media_type?: string;
    media_url?: string;
    caption?: string;
    timestamp?: string;
  };
  return {
    mediaType: data.media_type,
    mediaUrl: data.media_url,
    caption: data.caption,
    timestamp: data.timestamp,
  };
}

/**
 * Ask Claude to briefly describe a story image and quote any visible text.
 * Returns null on failure so the caller can proceed without image context.
 */
async function describeStoryImage(imageUrl: string): Promise<string | null> {
  try {
    const response = await vision.messages.create({
      model: VISION_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: imageUrl },
            },
            {
              type: "text",
              text: "This is an Instagram story. In 1-3 short sentences, describe what's in the image and QUOTE VERBATIM any text visible in the picture (overlays, captions, signs, screenshots). If there is no text, just describe the scene. Reply in plain prose, no preamble.",
            },
          ],
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return text || null;
  } catch (err) {
    log.warn("Story image description failed", { err: serializeError(err) });
    return null;
  }
}

/**
 * Build a human-readable context blurb describing the story a DM is replying
 * to. Prepended to the stored message text so Claude sees it as part of the
 * conversation. Returns null when no useful context can be assembled.
 */
export async function buildStoryReplyContext(
  platform: Platform,
  storyId: string,
): Promise<string | null> {
  try {
    const media = await fetchStoryMedia(platform, storyId);
    if (!media) return null;

    const parts: string[] = [];
    if (media.caption) parts.push(`Caption: "${media.caption}"`);

    if (media.mediaType === "VIDEO" && media.mediaUrl) {
      const transcript = await transcribeAudio(media.mediaUrl);
      if (transcript) parts.push(`Audio transcript: "${transcript}"`);
    }

    if (media.mediaType === "IMAGE" && media.mediaUrl) {
      const description = await describeStoryImage(media.mediaUrl);
      if (description) parts.push(`Image: ${description}`);
    }

    if (parts.length === 0) return null;
    return `[Context: this DM is a reply to Oleh's story. ${parts.join(" ")}]`;
  } catch (err) {
    log.warn("Story context lookup failed", {
      storyId,
      err: serializeError(err),
    });
    return null;
  }
}
