// Life Map v1 — discordBot.js
import { Client, GatewayIntentBits } from 'discord.js';
import { buildSystemPrompt } from './configLoader.js';
import { sendChat } from './googleClient.js';
import { buildStateString } from './dbAgent.js';
import { createConversation, assembleContext, insertMessage } from './sessionManager.js';

// ── Outbound Webhook (Keep for Cron logs) ──────────────────────────────────
export async function postToDiscord(message) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;

  try {
    const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });

    if (!res.ok) {
      console.error(`Discord webhook failed: ${res.status} ${res.statusText}`);
    }
  } catch (error) {
    console.error('Discord webhook error:', error.message);
  }
}

// ── Inbound Gateway Bot (Updated Listener) ─────────────────────────────────────
export function initDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    console.log('Discord Bot credentials missing. Skipping listener initialization.');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  // FIX: Changed from 'ready' to 'clientReady' to match the updated library version
  client.on('clientReady', (readyClient) => {
    console.log(`▶ Discord Gateway active: logged in as ${readyClient.user.tag}`);
    console.log(`▶ Monitoring channel ID: ${channelId}`);
  });

  client.on('messageCreate', async (message) => {
    // 1. Log every message seen in the server to see if intents are catching it
    console.log(`[Discord Link] Message spotted from ${message.author.tag} in channel ${message.channel.id}: "${message.content}"`);

    // Ignore bot identities
    if (message.author.bot) {
      console.log(`[Discord Link] Ignored message: Author is a bot.`);
      return;
    }

    // Ignore alternative channel noise
    if (message.channel.id !== channelId) {
      console.log(`[Discord Link] Ignored message: Channel ID does not match target channel.`);
      return;
    }

    const userText = message.content.trim();
    if (!userText) {
      console.log(`[Discord Link] Ignored message: Content is empty.`);
      return;
    }

    console.log(`[Discord Link] Message accepted. Dispatching execution pipeline to LLM engine...`);

    // Trigger standard visual typing feedback in Discord channel
    await message.channel.sendTyping();

    try {
      const session_id = 'discord_chat';

      // Setup context mirroring your server.js route
      await createConversation(session_id);
      const history = await assembleContext(session_id);
      await insertMessage(session_id, 'user', userText);

      // Build injection state payload
      const stateString = await buildStateString();
      const messageWithState = `[CURRENT STATE]\n${stateString}\n[/CURRENT STATE]\n\nUser: ${userText}`;
      
      console.log(`[Discord Link] Generating Gemini pipeline payload...`);
      
      // Process with LLM engine
      const replyText = await sendChat(history, buildSystemPrompt(), messageWithState);
      await insertMessage(session_id, 'model', replyText);

      console.log(`[Discord Link] LLM generated successfully. Relaying output to Discord...`);

      // Output response back into Discord
      await message.reply(replyText);
      console.log(`[Discord Link] Reply dispatched cleanly.`);

    } catch (error) {
      console.error('❌ Discord processing error:', error.message);
      await message.reply(`⚠ Core processing error: ${error.message}`);
    }
  });

  client.login(token);
}