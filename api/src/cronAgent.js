// Life Map v1 — cronAgent.js
// Phase 7: Autonomous cron layer
// All scheduled logic lives here. No LLM calls — narrative generation
// happens in server.js after these functions return their data objects.

import { supabase } from './supabaseClient.js'
import { getConfig } from './configLoader.js'

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

  // 3. Expire effects where end_date < today (if effects table exists)
  // await supabase.from('effect').update({ status: 'expired' }).lt('end_date', today)

  // 4. Flag decaying skills and stats (log only — edge function applies decay)
  const { data: decayingSkills } = await supabase
    .from('skill')
    .select('id, name')
    .lte('current_streak', -7)

  const { data: decayingStats } = await supabase
    .from('stat')
    .select('id, name')
    .lte('current_streak', -7)

  // 5. Update daily_state
  await supabase
    .from('daily_state')
    .update({
      morning_cron_ran: true,
      date: today
    })
    .eq('id', 1)

  // Passive energy regen
  const regen = mechanics.energy_recovery.passive_morning_regen

  // Get active arc multiplier (default 1.0 if none)
  const { data: arc } = await supabase
    .from('arc')
    .select('energy_regen_multiplier')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  const arcMult = arc?.energy_regen_multiplier ?? 1.0
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


  // 2. mandatory_met already set by complete_task SQL function — read from state
  const mandatoryMet = state.mandatory_met

  // 3. Update streak
  let newStreak = state.day_streak
  if (mandatoryMet) {
    newStreak = state.day_streak + 1
  } else {
    newStreak = state.day_streak - 1
  }

  // 4. Compute streak_multiplier (power curve)
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

  // 6. Decrement skill/stat streaks for non-hits today
  const { data: todayHits, error: hitsError } = await supabase
    .from('xp_ledger')
    .select('target_type, target_id')
    .in('target_type', ['skill', 'stat'])
    .gte('timestamp', today)

  if (hitsError) throw hitsError

  const hitSkillIds = new Set(
    (todayHits || []).filter(h => h.target_type === 'skill').map(h => h.target_id)
  )
  const hitStatIds = new Set(
    (todayHits || []).filter(h => h.target_type === 'stat').map(h => h.target_id)
  )

  // Fetch all skills and stats, decrement those not hit today
  const { data: allSkills } = await supabase.from('skill').select('id, current_streak')
  const { data: allStats }  = await supabase.from('stat').select('id, current_streak')

  const decayingSkills = []
  for (const skill of allSkills || []) {
    if (!hitSkillIds.has(skill.id)) {
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

  for (const stat of allStats || []) {
    if (!hitStatIds.has(stat.id)) {
      const newStatStreak = stat.current_streak - 1
      await supabase
        .from('stat')
        .update({ current_streak: newStatStreak })
        .eq('id', stat.id)
    }
  }

  // Count tasks completed today
  const { count: tasksCompletedToday } = await supabase
    .from('task')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .gte('completed_at', today)

  // Recovery task energy restoration


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

  // Count tasks that will be carried over (still pending with scheduled_at < tomorrow)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const { count: tasksToCarryOver } = await supabase
    .from('task')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('scheduled_at', tomorrow)
    .not('task_type', 'eq', 'routine')

  // 7. Roll daily_state
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

  // 8. Write daily_snapshot for graphs/history
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

  // 9. Build EOD summary object
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
// runCleanup
// Called by POST /cron/cleanup (GitHub Actions, weekly Sunday 03:00 UTC)
// Replaces the pg_cron TTL job retired in migration 17
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
