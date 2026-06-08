import { getRank } from './configLoader.js';
import { supabase } from './supabaseClient.js';
import * as logicAgent from './logicAgent.js';

// ─────────────────────────────────────────────────────────────────────────────
// getTasksToday
// Returns the full active task queue — all pending tasks regardless of
// scheduled date, plus tasks completed today. This is intentional:
// tasks are a queue, not a calendar. Users need to see everything pending.
// Historical dates are handled by GET /tasks?date=YYYY-MM-DD separately.
// ─────────────────────────────────────────────────────────────────────────────
export async function getTasksToday() {
  const today    = new Date().toISOString().split('T')[0]
  const todayEnd = `${today}T23:59:59`

  // Query 1: all pending tasks (full queue, no date filter)
  const { data: pendingData, error: pendingError } = await supabase
    .from('active_tasks')
    .select('*')
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (pendingError) throw pendingError

  // Query 2: tasks completed today (so they appear with strikethrough)
  const { data: completedToday, error: completedError } = await supabase
    .from('task')
    .select('*')
    .eq('status', 'completed')
    .gte('completed_at', `${today}T00:00:00`)
    .lte('completed_at', todayEnd)

  if (completedError) throw completedError

  // Merge, dedup by id
  const seen   = new Set()
  const merged = []
  for (const task of [...(pendingData || []), ...(completedToday || [])]) {
    if (!seen.has(task.id)) { seen.add(task.id); merged.push(task) }
  }

  // Filter routine tasks by passed time blocks
  const currentHour  = new Date().getHours()
  const passedBlocks = []
  if (currentHour >= 12) passedBlocks.push('morning')
  if (currentHour >= 14) passedBlocks.push('noon')
  if (currentHour >= 19) passedBlocks.push('evening')
  if (currentHour >= 22) passedBlocks.push('night')

  return merged.filter(task => {
    if (task.task_type !== 'routine') return true
    if (!task.time_block) return true
    if (task.status === 'completed') return true  // show completed routines
    return !passedBlocks.includes(task.time_block)
  })
}

export async function getNextTask() {
  // Next = earliest scheduled pending task, or any unscheduled pending
  const { data, error } = await supabase
    .from('active_tasks')
    .select('*')
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(1)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

export async function getPlayerState() {
  const [playerRes, energyRes, dailyRes] = await Promise.all([
    supabase.from('player').select('current_level, current_xp, xp_to_next, total_gold, available_gold').eq('id', 1).single(),
    supabase.from('energy_state').select('current, max, threshold_label').eq('id', 1).single(),
    supabase.from('daily_state').select('day_streak, mandatory_met, streak_multiplier, day_off_granted').eq('id', 1).single(),
  ])

  if (playerRes.error) throw playerRes.error
  if (energyRes.error) throw energyRes.error
  if (dailyRes.error)  throw dailyRes.error

  const player = playerRes.data
  const energy = energyRes.data
  const daily  = dailyRes.data

  return {
    level:          player.current_level,
    current_xp:     player.current_xp,
    xp_to_next:     player.xp_to_next,
    total_gold:     player.total_gold,
    available_gold: player.available_gold,
    energy: {
      current:         energy.current,
      max:             energy.max,
      threshold_label: energy.threshold_label,
    },
    streak: {
      day_streak:        daily.day_streak,
      mandatory_met:     daily.mandatory_met,
      streak_multiplier: daily.streak_multiplier,
      day_off_granted:   daily.day_off_granted,
    },
    day_off_granted: daily.day_off_granted,
  }
}

export async function buildStateString() {
  const playerState = await getPlayerState()
  const { level, current_xp, xp_to_next, available_gold, energy, streak } = playerState
  const rank = getRank(level)

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })

  const tasks     = await getTasksToday()
  const taskLines = tasks.length
    ? tasks.map(t =>
        `  [${t.id}] ${t.task_type.toUpperCase()} | ${t.title} | ${t.priority} | ${t.difficulty} | ${t.status}` +
        (t.scheduled_at ? ' | due ' + new Date(t.scheduled_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '')
      ).join('\n')
    : '  (none)'

  return [
    `DATE: ${dateStr} ${timeStr} EST`,
    `Lv${level} ${rank} | XP ${current_xp}/${xp_to_next} | Gold ${available_gold}g | Streak ${streak.day_streak} | Energy ${energy.current}/${energy.max} (${energy.threshold_label}) | Mandatory: ${streak.mandatory_met}`,
    `PENDING TASKS (full queue):\n${taskLines}`
  ].join('\n')
}

export async function addTask(taskData) {
  if (taskData.task_type === 'routine' && !taskData.recurrence_pattern) {
    taskData.recurrence_pattern = 'daily'
  }
  const { data, error } = await supabase.from('task').insert(taskData).select().single()
  if (error) throw error
  return data
}

export async function editTask(taskId, updates) {
  const ALLOWED = ['title','task_type','priority','difficulty','scheduled_at','time_block','description','is_recovery','arc_id']
  const fields  = Object.fromEntries(Object.entries(updates).filter(([k]) => ALLOWED.includes(k)))
  if (Object.keys(fields).length === 0) throw new Error('No valid fields to update')

  const { data: existing, error: fetchErr } = await supabase.from('task').select('id, status').eq('id', taskId).maybeSingle()
  if (fetchErr) throw fetchErr
  if (!existing) throw new Error(`Task not found: ${taskId}`)
  if (existing.status === 'completed') throw new Error('Cannot edit a completed task')
  if (existing.status === 'cancelled') throw new Error('Cannot edit a cancelled task')

  const { data, error } = await supabase.from('task').update(fields).eq('id', taskId).select().single()
  if (error) throw error
  return data
}

export async function removeTask(taskId) {
  const { data: task, error: fetchError } = await supabase.from('task').select('id, status').eq('id', taskId).maybeSingle()
  if (fetchError) throw fetchError
  if (!task) throw new Error(`Task not found: ${taskId}`)
  if (task.status === 'cancelled') throw new Error(`Task ${taskId} is already cancelled`)
  const { error: updateError } = await supabase.from('task').update({ status: 'cancelled' }).eq('id', taskId)
  if (updateError) throw updateError
  return { id: taskId, cancelled: true }
}

export async function rescheduleTask(taskId, updates) {
  const { data: task, error: fetchError } = await supabase.from('task').select('*').eq('id', taskId).single()
  if (fetchError) throw new Error('Task not found')
  if (task.status === 'completed' || task.status === 'cancelled') throw new Error('Cannot reschedule a completed or cancelled task')

  const fields = {}
  if (updates.scheduled_at) fields.scheduled_at = updates.scheduled_at
  if (updates.time_block)   fields.time_block    = updates.time_block
  if (Object.keys(fields).length === 0) throw new Error('Must provide scheduled_at and/or time_block')

  const { data, error } = await supabase.from('task').update(fields).eq('id', taskId).select().single()
  if (error) throw error
  return data
}

export async function addArc(arcData) {
  const { data, error } = await supabase.from('arc').insert({ ...arcData, status: 'active', energy_regen_multiplier: arcData.energy_regen_multiplier ?? 1.0 }).select().single()
  if (error) throw error
  return data
}

export async function getArcs() {
  const { data, error } = await supabase.from('arc').select('*').eq('status', 'active')
  if (error) throw error
  return data || []
}

export async function completeTask(taskId) {
  const { data: task, error: taskError } = await supabase.from('task').select('*').eq('id', taskId).single()
  if (taskError) throw taskError

  const player      = await getPlayerState()
  const { xp, gold } = logicAgent.computeTaskRewards(task)
  const energyDrain = logicAgent.computeEnergyDrain(task)
  const streakMult  = logicAgent.computeStreakMultiplier(player.streak.day_streak)
  const xpWithStreak = xp * (1 + streakMult)
  const leveledUp   = logicAgent.detectLevelUp(player.current_xp, player.xp_to_next, xpWithStreak)
  const { newLevel, newXp, newXpToNext } = logicAgent.computeNewLevel(player.level, player.current_xp, xpWithStreak)

  const { data, error } = await supabase.rpc('complete_task', {
    p_task_id:        taskId,
    p_xp_gained:      xpWithStreak,
    p_gold_gained:    gold,
    p_streak_mult:    1 + streakMult,
    p_arc_mult:       1.0,
    p_new_level:      newLevel,
    p_new_xp:         newXp,
    p_new_xp_to_next: newXpToNext,
    p_leveled_up:     leveledUp,
    p_energy_drain:   energyDrain,
    p_is_recovery:    task.is_recovery ?? false
  })

  if (error) {
    console.error('complete_task RPC failed:', { taskId, error: JSON.stringify(error) })
    throw error
  }
  if (!data) throw new Error(`complete_task returned null for task ${taskId}`)
  return data
}

export async function getShopItems() {
  const { data, error } = await supabase.from('economy_item').select('id, name, description, cost_gold, type').eq('active', true).order('cost_gold', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addShopItem(itemData) {
  const validTypes = ['leisure', 'day_off']
  if (!validTypes.includes(itemData.type)) throw new Error(`Invalid item type: ${itemData.type}`)
  const { data, error } = await supabase.from('economy_item').insert({ name: itemData.name, description: itemData.description, cost_gold: itemData.cost_gold, type: itemData.type }).select().single()
  if (error) throw error
  return data
}

export async function buyItem(itemId) {
  const { data: item, error: itemError } = await supabase.from('economy_item').select('id, name, cost_gold, active').eq('id', itemId).single()
  if (itemError || !item) throw new Error(`Item not found: ${itemId}`)
  if (!item.active) throw new Error(`Item not available: ${item.name}`)
  const { data, error } = await supabase.rpc('buy_item', { p_item_id: itemId, p_gold_cost: item.cost_gold })
  if (error) throw error
  if (!data) throw new Error(`buy_item returned null for item ${itemId}`)
  return data
}

export async function getStats() {
  const { data, error } = await supabase.from('stat').select('id, name, description, icon, current_value, current_streak').order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getShopWithCounts() {
  const today = new Date().toISOString().split('T')[0]
  const [itemsRes, purchasesRes] = await Promise.all([
    supabase.from('economy_item').select('id, name, description, cost_gold, type').eq('active', true).order('cost_gold', { ascending: true }),
    supabase.from('purchase_log').select('economy_item_id').gte('purchased_at', `${today}T00:00:00`)
  ])
  if (itemsRes.error)     throw itemsRes.error
  if (purchasesRes.error) throw purchasesRes.error
  const counts = {}
  for (const p of purchasesRes.data || []) { counts[p.economy_item_id] = (counts[p.economy_item_id] || 0) + 1 }
  return (itemsRes.data || []).map(item => ({ ...item, purchased_today: counts[item.id] || 0 }))
}

export async function getSnapshots() {
  const { data, error } = await supabase.from('daily_snapshot').select('*').order('date', { ascending: true }).limit(30)
  if (error) throw error
  return data || []
}

export async function getCalendar(month) {
  const [year, mon] = month.split('-').map(Number)
  const start = `${month}-01`
  const end   = new Date(year, mon, 1).toISOString().split('T')[0]

  const { data, error } = await supabase.from('task').select('scheduled_at, completed_at, status, late_multiplier, task_type')
    .not('task_type', 'eq', 'routine').neq('status', 'cancelled')
    .or(`scheduled_at.gte.${start}T00:00:00,scheduled_at.lt.${end}T00:00:00,completed_at.gte.${start}T00:00:00,completed_at.lt.${end}T00:00:00`)
  if (error) throw error

  const days = {}
  for (const task of data || []) {
    const dateStr = task.completed_at ? task.completed_at.split('T')[0] : task.scheduled_at ? task.scheduled_at.split('T')[0] : null
    if (!dateStr) continue
    if (!days[dateStr]) days[dateStr] = { total: 0, completed: 0, carried: 0, missed: 0 }
    days[dateStr].total++
    if (task.status === 'completed')                                      days[dateStr].completed++
    else if (task.late_multiplier != null && task.late_multiplier < 1.0)  days[dateStr].carried++
    else                                                                   days[dateStr].missed++
  }
  return days
}

export async function getSkills() {
  const { data, error } = await supabase.from('skill').select('id, name, description, category, is_dynamic, parent_skill_id, current_level, current_xp, xp_to_next, current_streak').order('current_level', { ascending: false })
  if (error) throw error
  return data || []
}

export async function renameSkill({ skill_id, new_name, new_description }) {
  const updates = { name: new_name }
  if (new_description !== undefined && new_description !== null) updates.description = new_description
  const { data, error } = await supabase.from('skill').update(updates).eq('id', skill_id).select('id, name, description, current_level, current_xp').single()
  if (error) throw new Error(`Failed to rename skill: ${error.message}`)
  return { success: true, skill: data, message: `Skill renamed to "${new_name}". Re-embedding in progress.` }
}
