import express, { type Request, type Response } from "express";
import { config } from "./config.js";
import { log } from "./logger.js";
import { handleVerification, verifySignature } from "./webhooks/verify.js";
import { handleWebhookBody } from "./webhooks/handler.js";
import { getAudio } from "./voice/audioStore.js";
import type { WebhookBody } from "./meta/types.js";

const app = express();

// Capture the raw body so we can verify the HMAC signature. Meta signs the
// exact bytes it sent — parsing first and re-serializing would break the MAC.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Serves freshly synthesized voice replies so Instagram can fetch them. The id
// is an unguessable UUID and entries expire minutes after creation.
app.get("/audio/:file", (req: Request, res: Response) => {
  const id = req.params.file.replace(/\.[a-z0-9]+$/i, "");
  const audio = getAudio(id);
  if (!audio) {
    res.sendStatus(404);
    return;
  }

  // Meta's media fetcher requests audio with a Range header and expects a 206
  // partial response. Express's res.send(Buffer) ignores Range and returns 200
  // with the whole body, which Meta rejects (download error 2018007). Handle
  // Range ourselves so the in-memory buffer streams like a real CDN.
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Accept-Ranges", "bytes");

  const range = req.headers.range;
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (match) {
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : audio.length - 1;
    if (start > end || start >= audio.length) {
      res.status(416).setHeader("Content-Range", `bytes */${audio.length}`).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${audio.length}`);
    res.setHeader("Content-Length", end - start + 1);
    res.end(audio.subarray(start, end + 1));
    return;
  }

  res.setHeader("Content-Length", audio.length);
  res.end(audio);
});

// Single callback URL handles both Instagram and Threads. Point the dashboard's
// "Callback URL" here:  https://<your-public-host>/webhooks
app.get("/webhooks", handleVerification);

app.post("/webhooks", (req: Request, res: Response) => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.header("x-hub-signature-256");

  if (!rawBody || !verifySignature(rawBody, signature)) {
    // Diagnostics (no secrets logged): a real Meta app secret is 32 chars.
    // secretLens shows the length of each configured secret (Instagram, then
    // Threads if set) — anything != 32 means the wrong value was pasted.
    // hasSignature false → header missing (app not subscribed / not signing).
    log.warn("Rejected webhook: bad signature", {
      hasRawBody: Boolean(rawBody),
      hasSignature: Boolean(signature),
      secretLens: config.meta.webhookSecrets.map((s) => s.length),
    });
    res.sendStatus(403);
    return;
  }

  // Acknowledge immediately (Meta expects a fast 200), then process async.
  res.sendStatus(200);

  handleWebhookBody(req.body as WebhookBody).catch((err) => {
    log.error("Unhandled error processing webhook", { err: String(err) });
  });
});

app.listen(config.port, () => {
  log.info("Webhook server listening", {
    port: config.port,
    callbackPath: "/webhooks",
  });
});
