import {
  getTasksToday,
  getNextTask,
  getPlayerState,
  addTask,
  removeTask,
  rescheduleTask,
  completeTask,
  addArc,
  getArcs,
  getShopItems,
  addShopItem,
  buyItem,
  renameSkill,
  getSkills
} from './dbAgent.js'

export async function handleToolCall(toolName, args) {
  switch (toolName) {
    case 'add_task':          return await addTask(args)
    case 'remove_task':       return await removeTask(args.task_id)
    case 'reschedule_task':   return await rescheduleTask(args.task_id, {
      scheduled_at: args.scheduled_at,
      time_block: args.time_block
    })
    case 'get_tasks':       return await getTasksToday()
    case 'get_next_task':   return await getNextTask()
    case 'get_player_state':return await getPlayerState()
    case 'complete_task':   return await completeTask(args.task_id)
    case 'add_arc':         return await addArc(args)
    case 'get_arcs':        return await getArcs()
    case 'get_shop_items':  return await getShopItems()
    case 'add_shop_item':   return await addShopItem(args)
    case 'buy_item':        return await buyItem(args.item_id)
    case 'rename_skill':    return await renameSkill(args)
    case 'get_skills':      return await getSkills()
    default: throw new Error(`Unknown tool: ${toolName}`)
  }
}
