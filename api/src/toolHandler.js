import { getTasksToday, getNextTask, getPlayerState } from './dbAgent.js'

export async function handleToolCall(toolName, args) {
  switch (toolName) {
    case 'get_tasks':        return await getTasksToday()
    case 'get_next_task':    return await getNextTask()
    case 'get_player_state': return await getPlayerState()
    default: throw new Error(`Unknown tool: ${toolName}`)
  }
}