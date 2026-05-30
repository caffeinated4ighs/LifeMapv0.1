// One-liners for Pass 1 — no parameters, minimal tokens
export const toolSummaries = [
  { name: 'get_tasks',        description: "Get today's tasks." },
  { name: 'get_next_task',    description: 'Get the single next pending task.' },
  { name: 'get_player_state', description: 'Get level, XP, gold, energy, streak.' }
]

// Full specs for Pass 2 — fetched by tool name after Pass 1 identifies intent
export const toolSpecMap = {
  get_tasks: {
    name: 'get_tasks',
    description: "Get today's tasks. Returns all pending and active tasks scheduled for today.",
    parameters: { type: 'object', properties: {}, required: [] }
  },
  get_next_task: {
    name: 'get_next_task',
    description: 'Get the single next pending task ordered chronologically.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  get_player_state: {
    name: 'get_player_state',
    description: 'Get current player stats: level, XP, gold, energy, and streak.',
    parameters: { type: 'object', properties: {}, required: [] }
  }
}