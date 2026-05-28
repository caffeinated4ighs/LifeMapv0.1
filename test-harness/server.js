import 'dotenv/config';
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSystemPrompt } from './prompts.js';
import { FAKE_STATE } from './fakeState.js';

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const PORT = process.env.PORT || 3001;

//----------------------------------------
//session store
//----------------------------------------
const sessions = {};

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/chat', async (req, res) => {
  const { session_id, message } = req.body;

  if (!session_id || !message) {
    return res.status(400).json({ error: 'session_id and message are required' });
  }

  if (!sessions[session_id]) {
    sessions[session_id] = [];
  }

  const history = sessions[session_id];

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      systemInstruction: buildSystemPrompt(FAKE_STATE),
    });
 
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    history.push({ role: 'user', parts: [{ text: message }] });
    history.push({ role: 'model', parts: [{ text: reply }] });
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    res.json({ reply });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Test harness running on port ${PORT}`));