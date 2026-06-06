import { GoogleGenerativeAI } from '@google/generative-ai'
import { toolSpecMap } from '../tool_spec.js'
import { handleToolCall } from './toolHandler.js'
import { getRuntime } from './configLoader.js'

let genAI = null

export function initGoogleClient() {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
}

export async function sendChat(history, systemPrompt, message) {

  const pass1SystemPrompt = systemPrompt +
    '\n\nIf the user is asking about tasks, stats, or game state, ' +
    'always use the appropriate tool. Do not answer from memory.'

  const fullSpecs = Object.values(toolSpecMap)

  // Pass 1 — Intent + Execution
  // Model receives all tool specs. With mode AUTO it decides whether to call
  // a tool or reply with plain text. Plain text exits here — one call total.
  const pass1Model = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    systemInstruction: pass1SystemPrompt,
    tools: [{ functionDeclarations: fullSpecs }],
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 500,
      ...(process.env.DEBUG_SEED && { seed: parseInt(process.env.DEBUG_SEED) })
    }
  })

  const chat1 = pass1Model.startChat({ history })
  const result1 = await sendWithRetry(chat1, message)
  if (process.env.NODE_ENV !== 'production') {
    const usage = result1.response.usageMetadata
    console.log(`[tokens] pass1 input: ${usage?.promptTokenCount} output: ${usage?.candidatesTokenCount}`)
  }
  const candidate1 = result1.response.candidates[0]
  const part1 = candidate1.content.parts[0]

  if (!part1.functionCall) {
    return result1.response.text()
  }

  const toolName = part1.functionCall.name
  const toolArgs = part1.functionCall.args
  const toolResult = await handleToolCall(toolName, toolArgs)

  // Pass 2 — Narration
  // No tools. Model receives the tool result and narrates it in persona.
  const pass2Model = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 400,
      ...(process.env.DEBUG_SEED && { seed: parseInt(process.env.DEBUG_SEED) })
    }
  })

  const chat2 = pass2Model.startChat({ history })
  const result2 = await sendWithRetry(
    chat2,
    `Tool result for ${toolName}:\n${JSON.stringify(toolResult, null, 2)}\n\nNarrate this to the user in your persona.`
  )
  if (process.env.NODE_ENV !== 'production') {
    const usage = result2.response.usageMetadata
    console.log(`[tokens] pass2 input: ${usage?.promptTokenCount} output: ${usage?.candidatesTokenCount}`)
  }

  return result2.response.text()
}

async function sendWithRetry(chat, message, maxRetries = 3) {
  let lastError
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await chat.sendMessage(message)
    } catch (err) {
      lastError = err
      const isHistoryBug = err.message?.includes('First content should be with role')
      console.error(`Gemini call failed (attempt ${attempt}/${maxRetries}) ${isHistoryBug ? '[history ordering bug]' : ''}:`, err.message)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 1000))
      }
    }
  }
  throw lastError
}