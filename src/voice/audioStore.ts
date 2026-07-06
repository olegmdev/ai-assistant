import crypto from "node:crypto";
import { config } from "../config.js";

// Instagram's send API fetches outbound audio from a URL we provide, so we hold
// the freshly synthesized MP3 in memory just long enough for Meta to pull it.
// Entries self-evict after a TTL to bound memory.

interface Entry {
  buffer: Buffer;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes — Meta fetches within seconds.
const store = new Map<string, Entry>();

/** Stash an MP3 and return the public URL Instagram should fetch it from. */
export function putAudio(buffer: Buffer): string | null {
  if (!config.publicBaseUrl) return null; // can't form a fetchable URL
  const id = crypto.randomUUID();
  store.set(id, { buffer, expiresAt: Date.now() + TTL_MS });
  return `${config.publicBaseUrl}/audio/${id}.wav`;
}

/** Retrieve a stored MP3 by id, or undefined if missing/expired. */
export function getAudio(id: string): Buffer | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(id);
    return undefined;
  }
  return entry.buffer;
}

// Periodic sweep so abandoned entries (Meta never fetched) don't linger.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) store.delete(id);
  }
}, TTL_MS).unref();
