import { GoogleGenerativeAI } from '@google/generative-ai'
import { toolSpecMap } from '../tool_spec.js'
import { handleToolCall } from './toolHandler.js'
import { getRuntime } from './configLoader.js'

let genAI = null

export function initGoogleClient() {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
}

export async function sendChat(history, systemPrompt, message) {

  // Ensure history starts with a user role chunk — Gemini hard-requires this.
  const safeHistory = history[0]?.role === 'model'
    ? history.slice(1)
    : history

  const pass1SystemPrompt = systemPrompt +
    '\n\nIf the user is asking about tasks, stats, or game state, ' +
    'always use the appropriate tool. Do not answer from memory.'

  const fullSpecs = Object.values(toolSpecMap)

  // Agentic loop — max 6 iterations
  const agentModel = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    systemInstruction: pass1SystemPrompt,
    tools: [{ functionDeclarations: fullSpecs }],
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 500,
      ...(process.env.DEBUG_SEED && { seed: parseInt(process.env.DEBUG_SEED) })
    }
  })

  const chat = agentModel.startChat({ history: safeHistory })
  let result = await sendWithRetry(chat, message)

  const toolResults = []
  let iterations = 0
  const MAX_ITERATIONS = 6

  while (iterations < MAX_ITERATIONS) {
    const candidate = result.response.candidates[0]
    const part = candidate?.content?.parts?.[0]

    // No function call — model is done with tools
    if (!part?.functionCall) break

    const { name, args } = part.functionCall

    if (process.env.NODE_ENV !== 'production') {
      const usage = result.response.usageMetadata
      console.log(`[tokens] loop iter ${iterations + 1} input: ${usage?.promptTokenCount} output: ${usage?.candidatesTokenCount}`)
    }

    const toolResult = await handleToolCall(name, args)
    const sanitizedResult = stripEmbeddings(toolResult)
    toolResults.push({ tool: name, result: sanitizedResult })
    iterations++

    // Feed result back into the same chat so the model has full context
    result = await sendWithRetry(
      chat,
      `Tool result for ${name}:\n${JSON.stringify(sanitizedResult)}`
    )
  }

  // Pure text response — no tools used at all
  if (toolResults.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      const usage = result.response.usageMetadata
      console.log(`[tokens] direct text input: ${usage?.promptTokenCount} output: ${usage?.candidatesTokenCount}`)
    }
    return result.response.text()
  }

  // Single narration pass — fresh generateContent, no chat history, system prompt for persona
  // Option A per spec: stateless generateContent call, not startChat
  const pass2Model = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 400,
      ...(process.env.DEBUG_SEED && { seed: parseInt(process.env.DEBUG_SEED) })
    }
  })

  const summary = `Completed ${toolResults.length} action(s):\n` +
    toolResults.map(r => `${r.tool}: ${JSON.stringify(r.result)}`).join('\n')

  const narration = await pass2Model.generateContent(
    `${summary}\n\nNarrate all of this to the user in your persona. Be concise.`
  )

  if (process.env.NODE_ENV !== 'production') {
    const usage = narration.response.usageMetadata
    console.log(`[tokens] pass2 narration input: ${usage?.promptTokenCount} output: ${usage?.candidatesTokenCount}`)
  }

  return narration.response.text()
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

// Recursively remove embedding vector fields from any object/array.
function stripEmbeddings(obj) {
  if (Array.isArray(obj)) return obj.map(stripEmbeddings)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'embedding_vector' || k === 'centroid_vector') continue
      out[k] = stripEmbeddings(v)
    }
    return out
  }
  return obj
}
