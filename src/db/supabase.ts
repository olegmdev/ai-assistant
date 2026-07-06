import { createClient } from "@supabase/supabase-js";
import { config, type Platform } from "../config.js";

export const supabase = createClient(
  config.supabase.url,
  config.supabase.secretKey,
  { auth: { persistSession: false } },
);

export type ConversationStatus = "active" | "paused";

export interface Conversation {
  id: string;
  platform: Platform;
  external_user_id: string;
  status: ConversationStatus;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

/** Find-or-create the conversation row for a (platform, user) pair. */
export async function getOrCreateConversation(
  platform: Platform,
  externalUserId: string,
): Promise<Conversation> {
  const { data: existing, error: selErr } = await supabase
    .from("conversations")
    .select("id, platform, external_user_id, status")
    .eq("platform", platform)
    .eq("external_user_id", externalUserId)
    .maybeSingle();

  if (selErr) throw selErr;
  if (existing) return existing as Conversation;

  const { data: created, error: insErr } = await supabase
    .from("conversations")
    .insert({ platform, external_user_id: externalUserId })
    .select("id, platform, external_user_id, status")
    .single();

  if (insErr) throw insErr;
  return created as Conversation;
}

/** Pause or resume the bot for a single conversation. */
export async function setConversationStatus(
  conversationId: string,
  status: ConversationStatus,
): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw error;
}

/**
 * Record an inbound message. Returns false if this message_id was already
 * stored (Meta retries deliveries) so the caller can skip reprocessing.
 */
export async function recordInboundMessage(
  conversationId: string,
  messageId: string,
  text: string,
): Promise<boolean> {
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: text,
    message_id: messageId,
  });

  if (error) {
    // 23505 = unique_violation on message_id → duplicate delivery.
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

export async function recordAssistantMessage(
  conversationId: string,
  text: string,
): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: text,
  });
  if (error) throw error;
}

/** Load recent turns for context, oldest first. */
export async function loadHistory(
  conversationId: string,
  limit = 20,
): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data as StoredMessage[]).reverse();
}

export interface CollabLead {
  brand?: string;
  contact?: string;
  collab_type?: string;
  budget?: string;
  timeline?: string;
  deliverables?: string;
  notes?: string;
}

/** Persist a collaboration lead captured by the assistant. */
export async function saveCollabLead(
  conversationId: string,
  platform: Platform,
  lead: CollabLead,
): Promise<void> {
  const { error } = await supabase.from("collab_leads").insert({
    conversation_id: conversationId,
    platform,
    ...lead,
  });
  if (error) throw error;
}
