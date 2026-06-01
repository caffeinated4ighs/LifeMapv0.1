import { getRank, loadConfig } from './configLoader.js';
import { supabase } from './supabaseClient.js';
import * as logicAgent from './logicAgent.js';

loadConfig()

export async function getTasksToday() {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('active_tasks')
    .select('*')
    .or(`scheduled_at.gte.${today},scheduled_at.lt.${tomorrow},time_block.not.is.null`)
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('Error fetching today\'s tasks:', error);
    throw error;
  }
  return data || [];
}


export async function getNextTask() {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('active_tasks')
    .select('*')
    .eq('status', 'pending')
    .or(`scheduled_at.gte.${today},scheduled_at.lt.${tomorrow},time_block.not.is.null`)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(1)
    .single();

  if (error) {
      if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching next task:', error);
    throw error;
  }

  return data;
}


export async function getPlayerState() {
  const [playerRes, energyRes, dailyRes] = await Promise.all([
    supabase
      .from('player')
      .select('current_level, current_xp, xp_to_next, total_gold, available_gold')
      .eq('id', 1)
      .single(),

    supabase
      .from('energy_state')
      .select('current, max, threshold_label')
      .eq('id', 1)
      .single(),

    supabase
      .from('daily_state')
      .select('day_streak, mandatory_met, streak_multiplier')
      .eq('id', 1)
      .single(),
  ]);

  if (playerRes.error) {
    console.error('Error fetching player:', playerRes.error);
    throw playerRes.error;
  }
  if (energyRes.error) {
    console.error('Error fetching energy_state:', energyRes.error);
    throw energyRes.error;
  }
  if (dailyRes.error) {
    console.error('Error fetching daily_state:', dailyRes.error);
    throw dailyRes.error;
  }

  const player = playerRes.data;
  const energy = energyRes.data;
  const daily = dailyRes.data;

  return {
    level: player.current_level,
    current_xp: player.current_xp,
    xp_to_next: player.xp_to_next,
    total_gold: player.total_gold,
    available_gold: player.available_gold,

    energy: {
      current: energy.current,
      max: energy.max,
      threshold_label: energy.threshold_label,
    },

    streak: {
      day_streak: daily.day_streak,
      mandatory_met: daily.mandatory_met,
      streak_multiplier: daily.streak_multiplier,
    }
  };
}


export async function buildStateString() {
  const playerState = await getPlayerState()
  const { level, current_xp, xp_to_next, available_gold, energy, streak } = playerState
  const rank = getRank(level)

  return `
PLAYER STATE:
- Level: ${level}
- Rank: ${rank}
- XP: ${current_xp} / ${xp_to_next}
- Gold: ${available_gold}g
- Streak: ${streak.day_streak} days
- Energy: ${energy.current} / ${energy.max} (${energy.threshold_label})
- Mandatory met: ${streak.mandatory_met}
`.trim()
}

export async function addTask(taskData) {
  const { data, error } = await supabase
    .from('task')
    .insert(taskData)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function removeTask(taskId) {
  const { data: task, error: fetchError } = await supabase
    .from('task')
    .select('id, status')
    .eq('id', taskId)
    .maybeSingle();

  if (fetchError) {
    console.error(`Error fetching task ${taskId}:`, fetchError);
    throw fetchError;
  }
  if (!task) {
    throw new Error(`Task Removal Failed: Task with ID ${taskId} does not exist.`);
  }
  if (task.status === 'cancelled') {
    throw new Error(`Task Removal Failed: Task with ID ${taskId} is already cancelled.`);
  }
  const { error: updateError } = await supabase
    .from('task')
    .update({ status: 'cancelled' })
    .eq('id', taskId);

  if (updateError) {
    console.error(`Error updating status for task ${taskId}:`, updateError);
    throw updateError;
  }
  return { id: taskId, cancelled: true };
}


export async function rescheduleTask(taskId, updates) {
  const { data: task, error: fetchError } = await supabase
    .from('task')
    .select('*')
    .eq('id', taskId)
    .single();

  if (fetchError) {
    throw new Error('Task not found');
  }
  if (!task) {
    throw new Error(`Task Removal Failed: Task with ID ${taskId} does not exist.`);
  }
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new Error('Cannot reschedule a completed or cancelled task');
  }
  const fields = {};
  if (updates.scheduled_at) {
    fields.scheduled_at = updates.scheduled_at;
  }
  if (updates.time_block) {
    fields.time_block = updates.time_block;
  }
  if (Object.keys(fields).length === 0) {
    throw new Error(
      'Must provide scheduled_at and/or time_block to reschedule'
    );
  }
  const { data, error } = await supabase
    .from('task')
    .update(fields)
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function addArc(arcData) {
  const { data, error } = await supabase
    .from('arc')
    .insert({
      ...arcData,
      status: 'active'
    })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

export async function getArcs() {
  const { data, error } = await supabase
    .from('arc')
    .select('*')
    .eq('status', 'active');
  if (error) {
    throw error;
  }
  return data || [];
}

export async function completeTask(taskId) {
  const { data: task, error: taskError } = await supabase
    .from('task')
    .select('*')
    .eq('id', taskId)
    .single();

  if (taskError) {
    throw taskError;
  }

  const player = await getPlayerState();
  const { xp, gold } = logicAgent.computeTaskRewards(task);
  
  const streakMult = logicAgent.computeStreakMultiplier(
    player.streak.day_streak
  );
  const xpWithStreak = xp * (1 + streakMult);

  const leveledUp = logicAgent.detectLevelUp(
    player.current_xp,
    player.xp_to_next,
    xpWithStreak
  );

  const {
    newLevel,
    newXp,
    newXpToNext
  } = logicAgent.computeNewLevel(
    player.level,
    player.current_xp,
    xpWithStreak
  );

  const { data, error } = await supabase.rpc('complete_task', {
    p_task_id: taskId,
    p_xp_gained: xpWithStreak,
    p_gold_gained: gold,
    p_streak_mult: 1 + streakMult,
    p_arc_mult: 1.0,
    p_new_level: newLevel,
    p_new_xp: newXp,
    p_new_xp_to_next: newXpToNext,
    p_leveled_up: leveledUp
  });

  if (error) {
    throw error;
  }

  return data;
}

const task = await addTask({
  title: 'Complete task test',
  task_type: 'project',
  priority: 'P1',
  difficulty: 'high'
})

console.log('created task id:', task.id)

const result = await completeTask(task.id)
console.log(result)