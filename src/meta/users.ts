import { config, type Platform } from "../config.js";
import { log, serializeError } from "../logger.js";

export interface UserProfile {
  name?: string;
  username?: string;
}

/**
 * Look up basic profile info for a DM sender. Instagram exposes `name` and
 * `username` on the IGSID via the Consumer Profile fields; Threads doesn't
 * expose an equivalent read via the messaging token, so we return null there.
 * Best-effort — returns null on any error so the caller can proceed.
 */
export async function fetchUserProfile(
  platform: Platform,
  userId: string,
): Promise<UserProfile | null> {
  if (platform !== "instagram") return null;
  const token = config.meta.instagramAccessToken;
  if (!token) return null;

  try {
    const url = `https://graph.instagram.com/${config.meta.graphApiVersion}/${userId}?fields=name,username`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log.warn("Failed to fetch user profile", {
        userId,
        status: res.status,
        detail: await res.text().catch(() => ""),
      });
      return null;
    }
    const data = (await res.json()) as { name?: string; username?: string };
    if (!data.name && !data.username) return null;
    return { name: data.name, username: data.username };
  } catch (err) {
    log.warn("User profile lookup failed", {
      userId,
      err: serializeError(err),
    });
    return null;
  }
}
