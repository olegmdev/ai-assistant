import { config, type Platform } from "../config.js";
import { log, serializeError } from "../logger.js";
import { transcribeAudio } from "../voice/elevenlabs.js";

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
