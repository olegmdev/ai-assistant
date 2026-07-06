import Anthropic from "@anthropic-ai/sdk";
import { config, type Platform } from "../config.js";
import { log } from "../logger.js";
import {
  loadHistory,
  saveCollabLead,
  type CollabLead,
} from "../db/supabase.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are Eve (Єва), the personal messaging assistant for Oleh Meleshko, replying to people who DM him on Instagram and Threads. You speak as a friendly, concise assistant on Oleh's behalf — warm, professional, and human. Keep replies short and natural for a DM (1-3 sentences); never sound like a form letter. If asked who you are, you're Eve, Oleh's assistant.

Your two jobs:
1. Answer questions people ask about Oleh, his work, and how to reach or work with him. If you genuinely don't know something specific, say you'll pass the question along to Oleh rather than inventing details.
2. Detect and collect collaboration / partnership / sponsorship / business inquiries. When someone proposes a collab or brand deal, naturally gather the useful details over the conversation: the brand or company, who they are, the type of collaboration, budget, timeline, and expected deliverables. Ask for missing pieces one or two at a time — don't interrogate.

When you have collected meaningful collab details (even partial), call the save_collab_lead tool so Oleh has the lead on record. Call it again to update if you learn more. After saving, reassure the person that Oleh will review and get back to them.

Never promise specific prices, dates, or commitments on Oleh's behalf — collect the information and tell them Oleh will follow up. Match the language the person writes in.

Never use M dashes or hyphens in your replies. Use only standard punctuation.`;

const SAVE_LEAD_TOOL: Anthropic.Tool = {
  name: "save_collab_lead",
  description:
    "Save or update a collaboration/partnership/sponsorship lead from this conversation so Oleh can review it. Call this whenever you have gathered meaningful details about a business inquiry, even if some fields are still unknown. Omit fields you don't yet know.",
  input_schema: {
    type: "object",
    properties: {
      brand: {
        type: "string",
        description: "Brand, company, or organization name.",
      },
      contact: {
        type: "string",
        description:
          "How to reach them — name, email, handle, or other contact info they shared.",
      },
      collab_type: {
        type: "string",
        description:
          "Type of collaboration (e.g. sponsored post, brand ambassador, event, podcast, affiliate).",
      },
      budget: {
        type: "string",
        description: "Stated budget or compensation, verbatim if given.",
      },
      timeline: {
        type: "string",
        description: "Timeline, dates, or deadline mentioned.",
      },
      deliverables: {
        type: "string",
        description: "What they want Oleh to produce or do.",
      },
      notes: {
        type: "string",
        description: "Any other relevant context worth recording.",
      },
    },
  },
};

/**
 * Generate (and persist) a reply for an inbound DM. Returns the text to send
 * back to the user, or null if there is nothing to say.
 */
export async function generateReply(
  conversationId: string,
  platform: Platform,
): Promise<string | null> {
  const history = await loadHistory(conversationId);
  if (history.length === 0) return null;

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Manual tool loop: let Claude call save_collab_lead, feed results back,
  // and continue until it produces a final text reply.
  for (let turn = 0; turn < 5; turn++) {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: [SAVE_LEAD_TOOL],
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // No tool call — collect the text reply and return it.
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text || null;
    }

    // Execute tool calls and feed results back.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      if (tool.name === "save_collab_lead") {
        try {
          await saveCollabLead(
            conversationId,
            platform,
            tool.input as CollabLead,
          );
          log.info("Saved collab lead", { conversationId, platform });
          results.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: "Lead saved. Oleh will see it.",
          });
        } catch (err) {
          log.error("Failed to save lead", { err: String(err) });
          results.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: "Could not save the lead right now.",
            is_error: true,
          });
        }
      }
    }
    messages.push({ role: "user", content: results });
  }

  log.warn("Tool loop exhausted without a final reply", { conversationId });
  return null;
}
