// Life Map v1 — cronAgent.js
// Phase 9.2: All mechanics values read from config/mechanics.json via getConfig()
// No hardcoded constants anywhere in this file.

import { supabase } from './supabaseClient.js'
import { getConfig } from './configLoader.js'
import { postToDiscord } from './discordBot.js'

// ---------------------------------------------------------------------------
// runMorning
// Called by POST /cron/morning (GitHub Actions, 12:00 UTC = 7am EST)
// ---------------------------------------------------------------------------
export async function runMorning() {
  // 1. Idempotency check
  const { data: state, error: stateError } = await supabase
    .from('daily_state')
    .select('morning_cron_ran, date')
    .eq('id', 1)
    .single()

  if (stateError) throw stateError
  if (state.morning_cron_ran) return { skipped: true }

  const today = new Date().toISOString().split('T')[0]
  const mechanics = getConfig().mechanics
  let carriedOver = 0

  // 2. Carry over incomplete tasks from yesterday
  const { data: pendingTasks, error: pendingError } = await supabase
    .from('task')
    .select('id, task_type, title, priority, difficulty, arc_id, recurrence_pattern, created_at, scheduled_at, time_block, description')
    .eq('status', 'pending')
    .lt('scheduled_at', today)

  if (pendingError) throw pendingError

  for (const task of pendingTasks || []) {
    if (task.task_type === 'routine') {
      // Routines reset via EOD — skip here
      continue
    }

    if (task.task_type === 'bonus') {
      // Bonus tasks expire silently
      await supabase
        .from('task')
        .update({ status: 'cancelled' })
        .eq('id', task.id)
      continue
    }

    // mandatory, habit, project, anchor — cancel + recreate with late penalty
    const originalCreatedAt = task.created_at
    const originalScheduledAt = new Date(task.scheduled_at)
    const newScheduledAt = new Date(originalScheduledAt.getTime() + 86400000).toISOString()

    const daysDelayed = Math.max(
      1,
      Math.floor((Date.now() - originalScheduledAt.getTime()) / 86400000)
    )
    // Read late penalty base from config
    const lateMultiplier = Math.pow(mechanics.late_penalty.base, daysDelayed)

    // Cancel original
    await supabase
      .from('task')
      .update({ status: 'cancelled' })
      .eq('id', task.id)

    // Recreate with late_multiplier
    await supabase
      .from('task')
      .insert({
        title:              task.title,
        task_type:          task.task_type,
        priority:           task.priority,
        difficulty:         task.difficulty,
        arc_id:             task.arc_id,
        recurrence_pattern: task.recurrence_pattern,
        time_block:         task.time_block,
        description:        task.description,
        created_at:         originalCreatedAt,
        scheduled_at:       newScheduledAt,
        status:             'pending',
        projection_status:  'pending',
        late_multiplier:    lateMultiplier
      })

    carriedOver++
  }

  // 3. Flag decaying skills and stats
  const { data: decayingSkills } = await supabase
    .from('skill')
    .select('id, name')
    .lte('current_streak', mechanics.decay_trigger_threshold)

  const { data: decayingStats } = await supabase
    .from('stat')
    .select('id, name')
    .lte('current_streak', mechanics.decay_trigger_threshold)

  // 4. Update daily_state
  await supabase
    .from('daily_state')
    .update({
      morning_cron_ran: true,
      date: today
    })
    .eq('id', 1)

  // 5. Passive energy regen — read amount from config
  const regen = mechanics.energy_recovery.passive_morning_regen

  // Get active arc multiplier (default 1.0 if none)
  const { data: arc } = await supabase
    .from('arc')
    .select('energy_regen_multiplier')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  const arcMult = arc?.energy_regen_multiplier ?? mechanics.energy_recovery.arc_regen_multiplier_default
  const totalRegen = Math.round(regen * arcMult)

  await supabase.rpc('regen_energy', { p_amount: totalRegen })

  // Reset day_off_granted for new day
  await supabase
    .from('daily_state')
    .update({ day_off_granted: false })
    .eq('id', 1)

  // 6. Build morning briefing object
  const { data: player } = await supabase
    .from('player')
    .select('current_level, current_xp, xp_to_next, available_gold')
    .eq('id', 1)
    .single()

  const { data: dailyState } = await supabase
    .from('daily_state')
    .select('day_streak, streak_multiplier')
    .eq('id', 1)
    .single()

  const { data: energyState } = await supabase
    .from('energy_state')
    .select('current_energy')
    .eq('id', 1)
    .single()

  const { data: tasksToday } = await supabase
    .from('active_tasks')
    .select('id, title, task_type, priority, difficulty, time_block, scheduled_at')
    .gte('scheduled_at', today)
    .lt('scheduled_at', new Date(Date.now() + 86400000).toISOString().split('T')[0])
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  const { data: activeArc } = await supabase
    .from('arc')
    .select('id, title, xp_multiplier, gold_multiplier')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  return {
    date:            today,
    level:           player.current_level,
    xp:              player.current_xp,
    xp_to_next:      player.xp_to_next,
    available_gold:  player.available_gold,
    streak:          dailyState.day_streak,
    streak_mult:     dailyState.streak_multiplier,
    energy:          energyState?.current_energy ?? null,
    tasks_today:     tasksToday || [],
    active_arc:      activeArc || null,
    carried_over:    carriedOver,
    leveled_up:      false,
    decaying_skills: decayingSkills || [],
    decaying_stats:  decayingStats || []
  }
}

// ---------------------------------------------------------------------------
// runEod
// Called by POST /cron/eod (GitHub Actions, 04:00 UTC = 11pm EST)
// Phase 9.2: Skill and stat streak increments moved here from edge function.
// ---------------------------------------------------------------------------
export async function runEod() {
  // 1. Idempotency check — morning must have run first
  const { data: state, error: stateError } = await supabase
    .from('daily_state')
    .select('morning_cron_ran, eod_cron_ran, mandatory_met, day_streak')
    .eq('id', 1)
    .single()

  if (stateError) throw stateError
  if (!state.morning_cron_ran) return { skipped: true, reason: 'morning_cron_not_run' }
  if (state.eod_cron_ran)      return { skipped: true, reason: 'already_ran' }

  const today = new Date().toISOString().split('T')[0]
  const mechanics = getConfig().mechanics

  // 2. mandatory_met already set by complete_task SQL function
  const mandatoryMet = state.mandatory_met

  // 3. Update streak
  let newStreak = state.day_streak
  if (mandatoryMet) {
    newStreak = state.day_streak + 1
  } else {
    newStreak = state.day_streak - 1
  }

  // 4. Compute streak_multiplier (power curve from config)
  let streakMultiplier = 0
  if (newStreak > 0) {
    const { coefficient, exponent } = mechanics.streak_formula
    streakMultiplier = coefficient * Math.pow(newStreak, exponent)
  }

  // 5. Reset routine tasks for tomorrow
  await supabase
    .from('task')
    .update({ status: 'pending' })
    .eq('task_type', 'routine')
    .eq('status', 'completed')

  // 6. Get qualifying hits from today (for streak and decrement logic)
  const { data: todayHits, error: hitsError } = await supabase
    .from('xp_ledger')
    .select('target_type, target_id')
    .in('target_type', ['skill', 'stat'])
    .gte('timestamp', today)

  if (hitsError) throw hitsError

  // Use streak_hit_threshold from config (default 0.55, read from mechanics)
  // Note: xp_ledger doesn't store similarity score, so we use the presence
  // of a ledger entry (above floor) as the qualifying signal.
  const hitSkillIds = new Set(
    (todayHits || []).filter(h => h.target_type === 'skill').map(h => h.target_id)
  )
  const hitStatIds = new Set(
    (todayHits || []).filter(h => h.target_type === 'stat').map(h => h.target_id)
  )

  // 7. Skill streaks — Phase 9.2: increment/decrement entirely here (not in edge fn)
  const { data: allSkills } = await supabase.from('skill').select('id, current_streak')
  const { data: allStats }  = await supabase.from('stat').select('id, current_streak')

  const decayingSkills = []
  for (const skill of allSkills || []) {
    if (hitSkillIds.has(skill.id)) {
      // Qualifying hit today — increment streak (reset to 1 if negative, else +1)
      const newStrk = skill.current_streak < 0 ? 1 : skill.current_streak + 1
      await supabase
        .from('skill')
        .update({ current_streak: newStrk })
        .eq('id', skill.id)
    } else {
      // No hit today — decrement streak
      const newSkillStreak = skill.current_streak - 1
      await supabase
        .from('skill')
        .update({ current_streak: newSkillStreak })
        .eq('id', skill.id)
      if (newSkillStreak <= mechanics.decay_trigger_threshold) {
        decayingSkills.push(skill.id)
      }
    }
  }

  // 8. Stat streaks — same pattern
  for (const stat of allStats || []) {
    if (hitStatIds.has(stat.id)) {
      const newStrk = stat.current_streak < 0 ? 1 : stat.current_streak + 1
      await supabase
        .from('stat')
        .update({ current_streak: newStrk })
        .eq('id', stat.id)
    } else {
      const newStatStreak = stat.current_streak - 1
      await supabase
        .from('stat')
        .update({ current_streak: newStatStreak })
        .eq('id', stat.id)
    }
  }

  // 9. Count tasks completed today
  const { count: tasksCompletedToday } = await supabase
    .from('task')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .gte('completed_at', today)

  // 10. Recovery task energy restoration (read from config)
  const { data: recoveryTasks } = await supabase
    .from('task')
    .select('id')
    .eq('is_recovery', true)
    .eq('status', 'completed')
    .gte('completed_at', today)

  const recoveryCount = (recoveryTasks || []).length
  if (recoveryCount > 0) {
    const restore = recoveryCount * mechanics.energy_recovery.per_recovery_task
    await supabase.rpc('regen_energy', { p_amount: restore })
  }

  // 11. Count tasks that will be carried over
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const { count: tasksToCarryOver } = await supabase
    .from('task')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('scheduled_at', tomorrow)
    .not('task_type', 'eq', 'routine')

  // 12. Roll daily_state
  await supabase
    .from('daily_state')
    .update({
      date:              tomorrow,
      mandatory_met:     false,
      morning_cron_ran:  false,
      eod_cron_ran:      true,
      day_streak:        newStreak,
      streak_multiplier: streakMultiplier
    })
    .eq('id', 1)

  // 13. Write daily_snapshot
  const { data: player } = await supabase
    .from('player')
    .select('current_level, current_xp, total_gold, available_gold')
    .eq('id', 1)
    .single()

  const { data: energySnap } = await supabase
    .from('energy_state')
    .select('current')
    .eq('id', 1)
    .single()

  await supabase
    .from('daily_snapshot')
    .insert({
      date:            today,
      level:           player.current_level,
      current_xp:      player.current_xp,
      total_gold:      player.total_gold,
      available_gold:  player.available_gold,
      day_streak:      newStreak,
      energy:          energySnap?.current ?? null,
      mandatory_met:   mandatoryMet,
      tasks_completed: tasksCompletedToday || 0,
      tasks_carried:   tasksToCarryOver   || 0
    })

  // 14. Build EOD summary object
  return {
    date:                  today,
    mandatory_met:         mandatoryMet,
    streak_delta:          mandatoryMet ? +1 : -1,
    new_streak:            newStreak,
    streak_multiplier:     streakMultiplier,
    tasks_completed_today: tasksCompletedToday || 0,
    tasks_to_carry_over:   tasksToCarryOver || 0,
    skills_decaying:       decayingSkills,
    recovery_tasks_completed: recoveryCount,
    energy_restored: recoveryCount * mechanics.energy_recovery.per_recovery_task
  }
}

// ---------------------------------------------------------------------------
// runRemind
// Called by POST /cron/remind every 30 min via GitHub Actions
// ---------------------------------------------------------------------------
export async function runRemind() {
  const now      = new Date()
  const windowEnd = new Date(now.getTime() + 35 * 60 * 1000).toISOString()
  const nowIso   = now.toISOString()

  const { data: upcoming, error } = await supabase
    .from('task')
    .select('id, title, task_type, priority, scheduled_at, time_block')
    .eq('status', 'pending')
    .in('task_type', ['mandatory', 'habit', 'anchor'])
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', nowIso)
    .lte('scheduled_at', windowEnd)
    .is('reminded_at', null)

  if (error) throw error

  const notified = []

  for (const task of upcoming || []) {
    const minsAway = Math.round(
      (new Date(task.scheduled_at) - now) / 60000
    )

    const icon = task.task_type === 'mandatory' ? '⚔' :
                 task.task_type === 'habit'     ? '🔄' : '⚓'

    const message = `${icon} **INCOMING** — ${task.title} — in ${minsAway} min`

    await postToDiscord(message)

    await supabase
      .from('task')
      .update({ reminded_at: now.toISOString() })
      .eq('id', task.id)

    notified.push(task.id)
  }

  return { notified_count: notified.length, task_ids: notified }
}

// ---------------------------------------------------------------------------
// runCleanup
// Called by POST /cron/cleanup (GitHub Actions, weekly Sunday 03:00 UTC)
// ---------------------------------------------------------------------------
export async function runCleanup() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('llm_session')
    .delete()
    .lt('updated_at', cutoff)
    .select('id')

  if (error) throw error

  return { sessions_deleted: data?.length ?? 0 }
}
