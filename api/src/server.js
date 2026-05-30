import 'dotenv/config';
import express from 'express';
import { loadConfig, buildSystemPrompt, getRuntime } from './configLoader.js';
import { createConversation, insertMessage, assembleContext } from './sessionManager.js';
import { initGoogleClient, sendChat } from './googleClient.js'
import { buildStateString } from './dbAgent.js';

loadConfig();
initGoogleClient();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || getRuntime().server.port;

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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));