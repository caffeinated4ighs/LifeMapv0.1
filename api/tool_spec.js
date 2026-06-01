// One-liners for Pass 1 — no parameters, minimal tokens
export const toolSummaries = [
  { name: 'get_tasks',        description: "Get today's tasks." },
  { name: 'get_next_task',    description: 'Get the single next pending task.' },
  { name: 'get_player_state', description: 'Get level, XP, gold, energy, streak.' },
  { name: 'add_task',        description: 'Add a new task for today or a future date.' },
  { name: 'remove_task',     description: 'Cancel a task by ID.' },
  { name: 'reschedule_task', description: 'Change when a task is scheduled.' },
  { name: 'complete_task',   description: 'Mark a task as done and award XP and gold.' },
  { name: 'add_arc',         description: 'Create a new long-term goal arc.' },
  { name: 'get_arcs',        description: 'List all active arcs.' },
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
  },
  add_task: {
    name: 'add_task',
    description: 'Add a new task. Requires title and task_type. Priority and difficulty default to P2 and medium.',
    parameters: {
      type: 'object',
      properties: {
        title:              { type: 'string', description: 'Task title' },
        task_type:          { type: 'string', enum: ['mandatory','habit','project','bonus','anchor'] },
        priority:           { type: 'string', enum: ['P0','P1','P2','P3'] },
        difficulty:         { type: 'string', enum: ['low','medium','high'] },
        description:        { type: 'string' },
        scheduled_at:       { type: 'string', description: 'ISO timestamp' },
        time_block:         { type: 'string', enum: ['morning','noon','evening','night','midnight'] },
        recurrence_pattern: { type: 'string', description: 'Cron-style string for recurring tasks' },
        arc_id:             { type: 'number', description: 'Arc ID to link this task to' }
      },
      required: ['title', 'task_type']
    }
  },

  remove_task: {
    name: 'remove_task',
    description: 'Cancel a task. Sets status to cancelled — does not delete.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'ID of the task to cancel' }
      },
      required: ['task_id']
    }
  },

  reschedule_task: {
    name: 'reschedule_task',
    description: 'Change a task scheduled_at timestamp or time_block. At least one must be provided.',
    parameters: {
      type: 'object',
      properties: {
        task_id:      { type: 'number' },
        scheduled_at: { type: 'string', description: 'New ISO timestamp' },
        time_block:   { type: 'string', enum: ['morning','noon','evening','night','midnight'] }
      },
      required: ['task_id']
    }
  },

  complete_task: {
    name: 'complete_task',
    description: 'Mark a task as done. Awards XP and gold. Updates streak. Detects level-up.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'ID of the task to complete' }
      },
      required: ['task_id']
    }
  },

  add_arc: {
    name: 'add_arc',
    description: 'Create a new long-term goal arc with optional deadline and multipliers.',
    parameters: {
      type: 'object',
      properties: {
        name:            { type: 'string' },
        description:     { type: 'string' },
        end_date:        { type: 'string', description: 'ISO date string YYYY-MM-DD' },
        xp_multiplier:   { type: 'number', description: 'Default 1.0' },
        gold_multiplier: { type: 'number', description: 'Default 1.0' }
      },
      required: ['name']
    }
  },

  get_arcs: {
    name: 'get_arcs',
    description: 'List all active arcs.',
    parameters: { type: 'object', properties: {}, required: [] }
  }
}