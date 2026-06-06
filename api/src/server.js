import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, buildSystemPrompt, getRuntime } from './configLoader.js';
import { createConversation, insertMessage, assembleContext } from './sessionManager.js';
import { initGoogleClient, sendChat } from './googleClient.js'
import {
  buildStateString,
  getPlayerState,
  getTasksToday,
  getStats,
  getShopWithCounts,
  getSnapshots,
  getCalendar,
  getSkills,
  buyItem
} from './dbAgent.js';
import { runMorning, runEod, runCleanup } from './cronAgent.js';
import { postToDiscord } from './discordBot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    const history = await assembleContext(session_id);

    await insertMessage(session_id, 'user', message);

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
// Static serving — serves api/index.html and api/css|js assets
// __dirname is api/src, so we step up one level to api/
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..')))

// ---------------------------------------------------------------------------
// Frontend data endpoints (GET, no auth, no LLM)
// ---------------------------------------------------------------------------

// Player state, energy, streak — used by navbar
app.get('/state', async (req, res) => {
  try {
    const state = await getPlayerState()
    return res.json(state)
  } catch (error) {
    console.error('GET /state error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// Tasks for a given date (defaults to today).
// Returns tasks where scheduled_at or completed_at falls on that date,
// plus all unscheduled pending tasks when date = today.
app.get('/tasks', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const date  = req.query.date || today

    // Re-use getTasksToday when requesting today — handles unscheduled
    // + routine time-block filtering correctly already.
    if (date === today) {
      const tasks = await getTasksToday()
      return res.json(tasks)
    }

    // Historical date — tasks scheduled or completed on that date.
    const { supabase } = await import('./supabaseClient.js')

    const [scheduledRes, completedRes] = await Promise.all([
      supabase
        .from('task')
        .select('*')
        .neq('status', 'cancelled')
        .gte('scheduled_at', `${date}T00:00:00`)
        .lte('scheduled_at', `${date}T23:59:59`),

      supabase
        .from('task')
        .select('*')
        .neq('status', 'cancelled')
        .gte('completed_at', `${date}T00:00:00`)
        .lte('completed_at', `${date}T23:59:59`)
    ])

    if (scheduledRes.error) throw scheduledRes.error
    if (completedRes.error) throw completedRes.error

    // Deduplicate by task id, prefer scheduled result as source of truth
    const seen = new Set()
    const merged = []
    for (const task of [...(scheduledRes.data || []), ...(completedRes.data || [])]) {
      if (!seen.has(task.id)) {
        seen.add(task.id)
        merged.push(task)
      }
    }
    merged.sort((a, b) => {
      if (!a.scheduled_at) return 1
      if (!b.scheduled_at) return -1
      return a.scheduled_at.localeCompare(b.scheduled_at)
    })

    return res.json(merged)
  } catch (error) {
    console.error('GET /tasks error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// Shop items with today's purchase counts
app.get('/shop', async (req, res) => {
  try {
    const items = await getShopWithCounts()
    return res.json(items)
  } catch (error) {
    console.error('GET /shop error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// All skills with XP, level, streak
app.get('/skills', async (req, res) => {
  try {
    const skills = await getSkills()
    return res.json(skills)
  } catch (error) {
    console.error('GET /skills error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// All 8 stats with current_value and streak
app.get('/stats', async (req, res) => {
  try {
    const stats = await getStats()
    return res.json(stats)
  } catch (error) {
    console.error('GET /stats error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// Last 30 days of daily_snapshot rows (chronological, for graphs)
app.get('/snapshots', async (req, res) => {
  try {
    const snapshots = await getSnapshots()
    return res.json(snapshots)
  } catch (error) {
    console.error('GET /snapshots error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// Per-day task summary for a month — used by calendar dots.
// Query param: month=YYYY-MM (defaults to current month)
// Returns: { "YYYY-MM-DD": { total, completed, carried, missed }, ... }
app.get('/calendar', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    const days = await getCalendar(month)
    return res.json(days)
  } catch (error) {
    console.error('GET /calendar error:', error.message)
    return res.status(500).json({ error: error.message })
  }
})

// Direct buy endpoint — bypasses LLM layer for instant UI purchases.
// The LLM buy_item tool path still works unchanged via /chat.
app.post('/buy/:itemId', async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId, 10)
    if (isNaN(itemId)) return res.status(400).json({ error: 'Invalid item ID' })
    const result = await buyItem(itemId)
    return res.json(result)
  } catch (error) {
    console.error('POST /buy error:', error.message)
    return res.status(400).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => res.json({ status: 'ok' }))

if (process.env.NODE_ENV !== 'production') {
  console.log('SYSTEM PROMPT LENGTH:', buildSystemPrompt().length)
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
