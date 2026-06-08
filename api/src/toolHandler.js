import {
  getTasksToday,
  getNextTask,
  getPlayerState,
  addTask,
  removeTask,
  rescheduleTask,
  editTask,
  completeTask,
  addArc,
  getArcs,
  getShopItems,
  addShopItem,
  buyItem,
  renameSkill,
  getSkills
} from './dbAgent.js'

async function generateTaskDescription(task) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const { getRuntime } = await import('./configLoader.js')
  const { supabase } = await import('./supabaseClient.js')

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
  const model = genAI.getGenerativeModel({
    model: getRuntime().model.name,
    generationConfig: { temperature: 0.7, maxOutputTokens: 60 }
  })

  const prompt = `Task: "${task.title}"
Type: ${task.task_type}, Priority: ${task.priority}, Difficulty: ${task.difficulty}
Write one sentence (max 15 words) describing what completing this task involves. Be specific. No filler.`

  const result = await model.generateContent(prompt)
  const description = result.response.text().trim()

  await supabase
    .from('task')
    .update({ description })
    .eq('id', task.id)
}

export async function handleToolCall(toolName, args) {
  switch (toolName) {
    case 'add_task': {
      const newTask = await addTask(args)
      if (!args.description) {
        generateTaskDescription(newTask).catch(err =>
          console.error('description gen failed:', err)
        )
      }
      return newTask
    }
    case 'remove_task':       return await removeTask(args.task_id)
    case 'reschedule_task':   return await rescheduleTask(args.task_id, {
      scheduled_at: args.scheduled_at,
      time_block: args.time_block
    })
    case 'edit_task':         return await editTask(args.task_id, args)
    case 'get_tasks':         return await getTasksToday()
    case 'get_next_task':     return await getNextTask()
    case 'get_player_state':  return await getPlayerState()
    case 'complete_task':     return await completeTask(args.task_id)
    case 'add_arc':           return await addArc(args)
    case 'get_arcs':          return await getArcs()
    case 'get_shop_items':    return await getShopItems()
    case 'add_shop_item':     return await addShopItem(args)
    case 'buy_item':          return await buyItem(args.item_id)
    case 'rename_skill':      return await renameSkill(args)
    case 'get_skills':        return await getSkills()
    default: throw new Error(`Unknown tool: ${toolName}`)
  }
}
