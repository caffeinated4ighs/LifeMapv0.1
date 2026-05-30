import { getRank } from './configLoader.js';
import { supabase } from './supabaseClient.js';
 

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