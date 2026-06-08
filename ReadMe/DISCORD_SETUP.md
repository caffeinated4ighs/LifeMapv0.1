# Life Map — Discord Setup Guide
**Version:** 2.0

Life Map uses Discord for two things:
1. **Outbound webhook** — morning briefings and EOD summaries posted to a channel automatically
2. **Inbound gateway bot** — chat with the Life Map agent directly from Discord

You can use just the webhook (simpler), or both. They use different credentials.

---

## Part 1 — Outbound Webhook (Morning + EOD posts)

This posts automated briefings to a Discord channel. No bot account needed.

### Step 1 — Create a webhook

1. Open Discord → go to the channel you want briefings in
2. Click the gear icon (Edit Channel) → Integrations → Webhooks
3. Click **New Webhook**
4. Give it a name (e.g. "Life Map") and optionally set an avatar
5. Click **Copy Webhook URL**

### Step 2 — Add to environment

Add to your `.env` (local) and Render environment variables:
```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
```

### Step 3 — Test

```bash
curl -X POST "$DISCORD_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content": "Life Map webhook test — if you see this, it works."}'
```

That's it. Morning briefings post automatically when GitHub Actions runs
`/cron/morning`. EOD summaries post when `/cron/eod` runs.

---

## Part 2 — Inbound Gateway Bot (Chat from Discord)

This lets you type commands in Discord and get LLM responses back, using the
same pipeline as the web interface.

### Step 1 — Create a Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name (e.g. "Life Map")
3. Click **Create**

### Step 2 — Create a bot user

1. In your application, click **Bot** in the left sidebar
2. Click **Add Bot** → confirm
3. Under **Token**, click **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** ← required, without this the bot can't read messages
   - **Server Members Intent** (optional)
5. Save changes

### Step 3 — Invite the bot to your server

1. In your application, click **OAuth2** → **URL Generator**
2. Under **Scopes**, check: `bot`
3. Under **Bot Permissions**, check:
   - Read Messages/View Channels
   - Send Messages
   - Read Message History
4. Copy the generated URL and open it in your browser
5. Select your server → Authorize

### Step 4 — Get your channel ID

1. In Discord, go to User Settings → Advanced → enable **Developer Mode**
2. Right-click the channel you want the bot to monitor → **Copy Channel ID**

### Step 5 — Add to environment

Add to your `.env` (local) and Render environment variables:
```
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here
```

### Step 6 — Verify it works

Start the server locally:
```bash
cd api && node src/server.js
```

You should see in the logs:
```
▶ Discord Gateway active: logged in as YourBot#1234
▶ Monitoring channel ID: 123456789
```

Type a message in your Discord channel — the bot should respond within a few seconds.

---

## Troubleshooting

**Bot is online but not responding to messages:**
- Check that **Message Content Intent** is enabled in the Discord developer portal
- Verify `DISCORD_CHANNEL_ID` matches the exact channel ID (right-click → Copy Channel ID)
- Check server logs for `[Discord Link]` messages to see if events are firing

**Webhook posts are not appearing:**
- Verify `DISCORD_WEBHOOK_URL` is set correctly in Render env vars
- Check that the webhook wasn't deleted in Discord (Integrations → Webhooks)
- Check GitHub Actions logs for the morning/eod cron jobs

**Bot goes offline when Render sleeps:**
- Render free tier spins down after 15 minutes of inactivity
- `health_ping.yml` pings every 14 minutes to prevent this
- Verify the `SERVER_URL` GitHub secret is set to your Render URL

**"Used disallowed intents" error:**
- Go to discord.com/developers/applications → your app → Bot
- Enable **Message Content Intent** under Privileged Gateway Intents
- Save and restart the server

---

## Architecture note

Both the webhook and the gateway bot are implemented in `api/src/discordBot.js`.
The gateway bot routes messages through the same `sendChat()` pipeline as the
web interface, using `session_id = 'discord_chat'` for context isolation.
