import { GoogleGenerativeAI } from '@google/generative-ai'
import { toolSummaries, toolSpecMap } from '../tool_spec.js'
import { handleToolCall } from './toolHandler.js'
import { getRuntime } from './configLoader.js'

let genAI = null

export function initGoogleClient() {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
}

export async function sendChat(history, systemPrompt, message) {

  // *** CHANGE 1: strengthened system prompt for Pass 1 ***
  // original systemPrompt alone wasn't reliable enough for intent detection
  // adding explicit instruction to always use tools for game state queries
  const pass1SystemPrompt = systemPrompt + '\n\nIf the user is asking about tasks, stats, or game state, always identify the appropriate tool. Do not answer from memory.'

  const pass1Model = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    systemInstruction: pass1SystemPrompt, // *** CHANGE 1: was systemPrompt ***
    tools: [{ functionDeclarations: toolSummaries }]
  })

  const chat1 = pass1Model.startChat({ history })
  const result1 = await chat1.sendMessage(message)
  const candidate1 = result1.response.candidates[0]
  const part1 = candidate1.content.parts[0]

  if (!part1.functionCall) {
    return result1.response.text()
  }

  const toolName = part1.functionCall.name

  const fullSpec = toolSpecMap[toolName]
  if (!fullSpec) {
    throw new Error(`No full spec found for tool: ${toolName}`)
  }

  const pass2Model = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: [fullSpec] }]
  })

  // *** CHANGE 2: added toolConfig to force function call in Pass 2 ***
  // without this Gemini sometimes returns plain text instead of calling
  // the tool — mode ANY + allowedFunctionNames forces exactly the right call
  const chat2 = pass2Model.startChat({ 
    history,
    toolConfig: {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [toolName]
      }
    }
  })

  const result2 = await chat2.sendMessage(message)
  const candidate2 = result2.response.candidates[0]
  const part2 = candidate2.content.parts[0]

  if (!part2.functionCall) {
    throw new Error(`Pass 2 expected a function call for ${toolName} but got plain text`)
  }

  const toolArgs = part2.functionCall.args
  const toolResult = await handleToolCall(toolName, toolArgs)

  const pass3Model = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    systemInstruction: systemPrompt,
  })

  const chat3 = pass3Model.startChat({ history })
  const result3 = await chat3.sendMessage(
    `Tool result for ${toolName}:\n${JSON.stringify(toolResult, null, 2)}\n\nNarrate this to the user in your persona.`
  )

  return result3.response.text()
}