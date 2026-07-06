# Oleh AI Assistant — Instagram & Threads webhooks

An AI assistant that handles **Oleh Meleshko's** Instagram and Threads DMs. It
answers questions and detects/collects collaboration & partnership requests,
saving them to Supabase for Oleh to review. Replies are generated with
**Claude Opus 4.8**.

## Stack

- **Node + TypeScript + Express** — single webhook server for both platforms
- **Claude Opus 4.8** (`@anthropic-ai/sdk`) — replies + collab-lead extraction
- **Supabase** — conversations, messages, and `collab_leads`
- **cloudflared** — public HTTPS tunnel for local development (no account needed)

## How it works

```
Instagram/Threads DM
      │  (webhook POST, HMAC-signed)
      ▼
POST /webhooks ── verify signature ── 200 OK (immediately)
      │
      ▼ (async)
extract message → upsert conversation → dedupe by mid → store message
      │
      ▼
Claude Opus 4.8  ──[ save_collab_lead tool ]──▶  Supabase collab_leads
      │
      ▼
send reply via Graph API (graph.instagram.com / graph.threads.net)
```

## Setup

### 1. Install

```bash
npm install
cp .env.example .env   # then fill in the blanks
```

### 2. Create the database tables

Open the Supabase project (`pvqrjqwswqbrjxmjcgep`) → **SQL Editor**, paste the
contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.

### 3. Fill in `.env`

| Variable | Where to get it |
| --- | --- |
| `INSTAGRAM_APP_SECRET` | Meta App Dashboard → App settings → Basic → App secret (legacy `META_APP_SECRET` still accepted) |
| `THREADS_APP_SECRET` | Threads product settings → "Threads app secret" → Show. Threads signs its webhooks with this, not the Instagram secret. |
| `WEBHOOK_INSTAGRAM_VERIFY_TOKEN` | Invent a long random string (you'll paste the same value into the Instagram dashboard; legacy `WEBHOOK_VERIFY_TOKEN` still accepted) |
| `WEBHOOK_THREADS_VERIFY_TOKEN` | Optional separate token for the Threads dashboard; leave blank to reuse the Instagram one |
| `INSTAGRAM_ACCESS_TOKEN` | Step 2 "Generate access tokens" in the dashboard |
| `THREADS_ACCESS_TOKEN` | Same, for the Threads account |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API keys → **Secret key** (`sb_secret_…`); on older projects use the legacy `service_role` key. Either is accepted. |

`SUPABASE_URL` is already set to your project.

### 4. Run it and open a tunnel

```bash
npm run dev          # terminal 1 — starts the server on :3000
npm run tunnel       # terminal 2 — cloudflared tunnel to localhost:3000
```

Install the tunnel once with `brew install cloudflared` (no account needed).
It prints a public URL like `https://random-words-here.trycloudflare.com`.
A fresh URL is generated each time you start it.

### 5. Finish the dashboard "Configure webhooks" step

Back on the screen you're on:

- **Callback URL**: `https://random-words-here.trycloudflare.com/webhooks`
- **Verify token**: the exact `WEBHOOK_INSTAGRAM_VERIFY_TOKEN` value from your `.env` (or `WEBHOOK_THREADS_VERIFY_TOKEN` when configuring the Threads product)

Click **Verify and save**. Meta hits `GET /webhooks`, the server echoes the
challenge, and the webhook is registered. Then subscribe to the **messages**
field so DMs are delivered. Do this for both the Instagram and Threads products.

> The dashboard note "To receive webhooks, your app must be in published state"
> applies to live traffic. While testing, the account you added as a **tester**
> (Oleh's profile) will deliver webhooks without publishing the app.

## Taking over a conversation (interrupt the bot)

The assistant is named **Eve / Єва**. If you want to handle a DM yourself, send a
message **from Oleh's account, in that thread**:

- **Pause** the bot: `Eve, stop` · `Єва, стоп` (also: pause / пауза / стій / зупинись)
- **Resume** the bot: `Єва, продовжуй` · `Eve, resume` (also: continue / go / далі / старт)

Pause/resume applies **only to that one conversation**. While paused, incoming
messages are still saved (so context is intact), but the bot stays silent until
you resume. Your own messages keep going through to the person normally.

How it works: messages you send from the account arrive as webhook *echoes*
(`is_echo: true`). The server checks each echo for the name + a stop/resume word
and toggles that thread — see [src/control.ts](src/control.ts). Because only
echoes are checked, a regular user typing "Eve, stop" **cannot** pause the bot;
only the account owner can.

> Requires Instagram to deliver echo webhooks for messages you send (subscribe to
> the `messages` field, which includes echoes). If echoes aren't delivered for
> natively-sent app messages on your setup, the same commands still work when
> sent through the API. There's no reply back to you confirming the toggle — the
> server just logs it (a DM confirmation would be visible to the other person).

## Production

`npm run build && npm start`. Deploy anywhere with a stable HTTPS URL (Railway,
Render, Fly, a VPS) and set the Callback URL to `https://<host>/webhooks`. The
verify token and app-secret signature check work identically there.

## Notes & limitations

- **Threads DM sending**: Instagram DM send is fully supported. Threads delivers
  webhooks, but DM *send* depends on the messaging permission being granted to
  your Threads app — if it isn't, `sendTextMessage` for Threads returns a
  permissions error (logged, non-fatal). Comment/mention handling can be added
  in `extractInboundMessages` via the `changes` field when you need it.
- The server acknowledges every webhook with `200` immediately and processes in
  the background, as Meta requires.
- Duplicate webhook deliveries are deduped by the unique `message_id`.
