import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { log } from "../logger.js";

/**
 * GET handshake. Meta calls this once when you click "Verify and save" with the
 * Callback URL + Verify token. We echo hub.challenge back iff the token matches.
 */
export function handleVerification(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    config.meta.verifyTokens.includes(token)
  ) {
    log.info("Webhook verified");
    res.status(200).send(challenge);
    return;
  }

  log.warn("Webhook verification failed", { mode });
  res.sendStatus(403);
}

/**
 * Validate the X-Hub-Signature-256 header against the raw request body. Tries
 * every configured app secret (Instagram + Threads) since each platform signs
 * with its own secret. Rejects forged/replayed POSTs.
 */
export function verifySignature(rawBody: Buffer, signatureHeader?: string): boolean {
  if (!signatureHeader) return false;
  const provided = Buffer.from(signatureHeader);

  for (const secret of config.meta.webhookSecrets) {
    const expected = Buffer.from(
      "sha256=" +
        crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
    );
    if (
      provided.length === expected.length &&
      crypto.timingSafeEqual(provided, expected)
    ) {
      return true;
    }
  }
  return false;
}
