import { getConfig } from './configLoader.js'

export function computeTaskRewards(task) {
  const config = getConfig();
  const mechanics = config.mechanics;

  if (task.task_type === 'routine') {
    return { xp: mechanics.xp_base.routine, gold: mechanics.gold_base_routine };
  }

  const effectiveType = task.task_type === 'anchor' ? 'project' : task.task_type
  const xp = mechanics.xp_base[effectiveType]

  let gold = mechanics.gold_base[task.priority];
  gold += mechanics.gold_difficulty_offset[task.difficulty];
  gold = Math.max(gold, mechanics.gold_floor);

  return { xp, gold };
}

export function computeStreakMultiplier(dayStreak) {
  if (dayStreak <= 0) {
    return 0;
  }

  const config = getConfig();
  const mechanics = config.mechanics;
  const formula = mechanics.streak_formula;

  const bonus = formula.coefficient * (dayStreak ** formula.exponent);
  return bonus;
}

export function computeXpToNext(level, formulaKey) {
  const formula = getConfig().mechanics[formulaKey]

  if (level === 0) return formula.level_0_xp
  if (level === 1) return formula.level_1_xp

  let xp = formula.base_xp
  for (let k = 2; k <= level; k++) {
    xp *= formula.base_multiplier -
          formula.decay_rate * (k - 2) / (k + formula.decay_offset)
  }
  return Math.round(xp)
}

export function detectLevelUp(currentXp, xpToNext, xpGained) {
  return currentXp + xpGained >= xpToNext;
}

export function computeNewLevel(currentLevel, currentXp, xpGained) {
  let level = currentLevel;
  let xp = currentXp + xpGained;
  let xpToNext = computeXpToNext(level, 'xp_level_formula')

  while (xp >= xpToNext) {
    xp -= xpToNext;           // carry over overflow
    level += 1;               // level up
    xpToNext = computeXpToNext(level, 'xp_level_formula');  // recompute for new level
  }

  return { 
    newLevel: level, 
    newXp: xp, 
    newXpToNext: xpToNext 
  };
}

export function deriveCrossoverLabel(similarityScore) {
  const config = getConfig();
  const crossoverLabels = config.mechanics.skill_xp_crossover_label;

  for (const [label, range] of Object.entries(crossoverLabels)) {
    if (similarityScore >= range.min && similarityScore <= range.max) {
      return label;
    }
  }

  return null;
}

