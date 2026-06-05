import 'dotenv/config';
import express from 'express';
import { loadConfig, buildSystemPrompt, getRuntime } from './configLoader.js';
import { createConversation, insertMessage, assembleContext } from './sessionManager.js';
import { initGoogleClient, sendChat } from './googleClient.js'
import { buildStateString } from './dbAgent.js';
import { runMorning, runEod, runCleanup } from './cronAgent.js';
import { postToDiscord } from './discordBot.js';

loadConfig();
initGoogleClient();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || getRuntime().server.port;

// ---------------------------------------------------------------------------
// Cron secret middleware
// ---------------------------------------------------------------------------
function requireCronSecret(req, res, next) {
  const secret = req.headers['x-cron-secret']
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ---------------------------------------------------------------------------
// Briefing narrative helper
// ---------------------------------------------------------------------------
async function narrateBriefing(data, type) {
  const prompt = type === 'morning'
    ? `Morning briefing data:\n${JSON.stringify(data, null, 2)}\n\nWrite the morning system briefing in your persona. Short, structured, cold. Cover: date, player state, tasks for today, active arc if any. End with "System ready."`
    : `EOD summary data:\n${JSON.stringify(data, null, 2)}\n\nWrite the end of day summary in your persona. Short. Cover: mandatory status, streak change, tasks completed. End with "Day logged."`
  return await sendChat([], buildSystemPrompt(), prompt)
}

// ---------------------------------------------------------------------------
// Insert a system message into the default session context
// ---------------------------------------------------------------------------
async function insertSystemMessage(role, text) {
  const DEFAULT_SESSION = 'system'
  await createConversation(DEFAULT_SESSION)
  await insertMessage(DEFAULT_SESSION, 'model', text)
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
app.post('/chat', async (req, res) => {
  try {
    const { session_id, message } = req.body;

    if (!session_id || !message) {
      return res.status(400).json({ error: 'Missing session_id or message' });
    }

    await createConversation(session_id);
    await insertMessage(session_id, 'user', message);

    const history = await assembleContext(session_id);

    const stateString = await buildStateString()
    const messageWithState = `[CURRENT STATE]\n${stateString}\n[/CURRENT STATE]\n\nUser: ${message}`
    const replyText = await sendChat(history, buildSystemPrompt(), messageWithState)

    await insertMessage(session_id, 'model', replyText);

    return res.json({ reply: replyText });

  } catch (error) {
    console.error('Gemini error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Cron routes
// ---------------------------------------------------------------------------
app.post('/cron/morning', requireCronSecret, async (req, res) => {
  try {
    const result = await runMorning()
    if (result.skipped) return res.json({ status: 'already_ran' })

    const briefingText = await narrateBriefing(result, 'morning')
    await insertSystemMessage('system', briefingText)
    await postToDiscord(briefingText)

    return res.json({ status: 'ok', briefing: briefingText })
  } catch (error) {
    console.error('Morning cron error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

app.post('/cron/eod', requireCronSecret, async (req, res) => {
  try {
    const result = await runEod()
    if (result.skipped) return res.json({ status: 'skipped', reason: result.reason })

    const summaryText = await narrateBriefing(result, 'eod')
    await insertSystemMessage('system', summaryText)
    await postToDiscord(summaryText)

    return res.json({ status: 'ok', summary: summaryText })
  } catch (error) {
    console.error('EOD cron error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

app.post('/cron/cleanup', requireCronSecret, async (req, res) => {
  try {
    const result = await runCleanup()
    return res.json({ status: 'ok', ...result })
  } catch (error) {
    console.error('Cleanup cron error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
