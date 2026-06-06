// Full specs — all tools passed to Pass 1
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
    description: 'Add a new task. Requires title and task_type. Priority and difficulty default to P2 and medium. If no scheduled_at or time_block is provided, the task will appear in the daily list without a specific time slot', 
    parameters: {
      type: 'object',
      properties: {
        title:              { type: 'string', description: 'Task title' },
        task_type: { type: 'string', enum: ['mandatory','habit','project','bonus','anchor','routine'] },
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
  },

  get_shop_items: {
    name: 'get_shop_items',
    description: 'Returns all active shop items ordered by cost ascending. Shows id, name, description, gold cost, and type.',
    parameters: { type: 'object', properties: {}, required: [] }
  },

  add_shop_item: {
    name: 'add_shop_item',
    description: 'Add a new item to the shop catalogue. LLM-writable. Type must be leisure or day_off.',
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Item name' },
        description: { type: 'string', description: 'What the item is or grants' },
        cost_gold:   { type: 'number', description: 'Gold cost' },
        type:        { type: 'string', enum: ['leisure', 'day_off'] }
      },
      required: ['name', 'description', 'cost_gold', 'type']
    }
  },

  buy_item: {
    name: 'buy_item',
    description: 'Purchase an item from the shop. Deducts gold from available_gold only. total_gold is never decremented. Fails if insufficient gold or item inactive.',
    parameters: {
      type: 'object',
      properties: {
        item_id: { type: 'number', description: 'ID of the item to purchase' }
      },
      required: ['item_id']
    }
  },
  get_skills: {
    name: 'get_skills',
    description: 'List all skills with their numeric ids, names, levels, XP, and streaks. Call this before rename_skill to get the skill_id.',
    parameters: { type: 'object', properties: {}, required: [] }
  },  
  rename_skill: {
    name: 'rename_skill',
    description:
      'Rename a dynamic skill. You MUST call get_skills first to get the numeric skill_id — ' +
      'never guess or infer the id from the skill name. ' +
      'Use when the user wants to give a skill a better name or broader scope. ' +
      'The system will automatically re-embed the skill under the new name. ' +
      'Always confirm the new name with the user before calling this tool.',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'number',
          description:
            'The id of the skill to rename. Get this from get_player_state or by asking the user which skill they mean.'
        },
        new_name: {
          type: 'string',
          description: 'The new name for the skill. One to four words.'
        },
        new_description: {
          type: 'string',
          description:
            'Optional updated description. If omitted, the existing description is kept.'
        }
      },
      required: ['skill_id', 'new_name']
    }
  } 
}
