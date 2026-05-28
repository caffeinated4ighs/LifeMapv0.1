import 'dotenv/config';
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSystemPrompt } from './prompts.js';
import { FAKE_STATE } from './fakeState.js';
import { createConversation, insertMessage, assembleContext } from './sessionManager.js';
import { config } from './config.js';

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const PORT = process.env.PORT || config.server.port;

app.post('/chat', async (req, res) => {
  try {
    const { session_id, message } = req.body;

    if (!session_id || !message) {
      return res.status(400).json({ error: 'Missing session_id or message' });
    }

    createConversation(session_id);
    insertMessage(session_id, 'user', message);

    const history = assembleContext(session_id);

    const model = genAI.getGenerativeModel({
      model: config.model.name, // Used config
      systemInstruction: buildSystemPrompt(FAKE_STATE),
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const replyText = result.response.text();

    insertMessage(session_id, 'model', replyText);

    return res.json({ reply: replyText });

  } catch (error) {
    console.error('Gemini error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));