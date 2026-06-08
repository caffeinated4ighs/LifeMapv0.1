// supabase/functions/post-task-completion/index.ts
//
// Life Map — Phase 9.2 (fixed)
// Triggered by DB webhook on task UPDATE when status → 'completed'
//
// FIXES vs previous version:
//   - stat column: current_xp → current_value (matches actual migration 04 schema)
//   - stat select: "current_xp" → "current_value" (was returning undefined → NaN update)
//   - streak increments REMOVED entirely (EOD cron owns all streak changes)
//   - stat_match_floor separate from skill_match_floor (stats use lower floor 0.40)
//   - reads all thresholds from app_config row

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Fallback constants — mirror config/mechanics.json exactly.
const FALLBACK_SKILL_MATCH_FLOOR      = 0.65;
const FALLBACK_STAT_MATCH_FLOOR       = 0.40;
const FALLBACK_CANDIDATE_THRESHOLD    = 3;
const FALLBACK_CANDIDATE_MAX_DISTANCE = 0.4;

const FALLBACK_PROJECTION_TIERS = [
  { min: 0.30, max: 0.399, multiplier: 0.1 },
  { min: 0.40, max: 0.499, multiplier: 0.2 },
  { min: 0.50, max: 0.599, multiplier: 0.3 },
  { min: 0.60, max: 0.699, multiplier: 0.4 },
  { min: 0.70, max: 0.799, multiplier: 0.5 },
  { min: 0.80, max: 0.899, multiplier: 0.6 },
  { min: 0.90, max: 0.999, multiplier: 0.7 },
  { min: 1.00, max: 1.001, multiplier: 0.8 },
];

const FALLBACK_XP_BASE: Record<string, number> = {
  mandatory: 10, habit: 12, project: 15, bonus: 6, anchor: 10, routine: 4,
};

const SKILL_XP_BASE_MULTIPLIER = 1.030;
const SKILL_XP_DECAY_RATE      = 0.0050;
const SKILL_XP_DECAY_OFFSET    = 55;

interface MechanicsConfig {
  skill_match_floor: number;
  stat_match_floor: number;
  skill_candidate_threshold: number;
  skill_candidate_max_distance: number;
  projection_tiers: Array<{ min: number; max: number; multiplier: number }>;
  xp_base: Record<string, number>;
}

async function loadConfig(supabase: ReturnType<typeof createClient>): Promise<MechanicsConfig> {
  try {
    const { data, error } = await supabase
      .from("app_config").select("mechanics").eq("id", 1).single();
    if (error || !data?.mechanics) { console.warn("app_config fallback:", error?.message); return fallbackConfig(); }
    const m = data.mechanics;
    return {
      skill_match_floor:            m.skill_match_floor            ?? FALLBACK_SKILL_MATCH_FLOOR,
      stat_match_floor:             m.stat_match_floor             ?? FALLBACK_STAT_MATCH_FLOOR,
      skill_candidate_threshold:    m.skill_candidate_threshold    ?? FALLBACK_CANDIDATE_THRESHOLD,
      skill_candidate_max_distance: m.skill_candidate_max_distance ?? FALLBACK_CANDIDATE_MAX_DISTANCE,
      projection_tiers:             m.projection_tiers             ?? FALLBACK_PROJECTION_TIERS,
      xp_base:                      m.xp_base                      ?? FALLBACK_XP_BASE,
    };
  } catch (e) { console.error("Config error:", e); return fallbackConfig(); }
}

function fallbackConfig(): MechanicsConfig {
  return {
    skill_match_floor: FALLBACK_SKILL_MATCH_FLOOR, stat_match_floor: FALLBACK_STAT_MATCH_FLOOR,
    skill_candidate_threshold: FALLBACK_CANDIDATE_THRESHOLD, skill_candidate_max_distance: FALLBACK_CANDIDATE_MAX_DISTANCE,
    projection_tiers: FALLBACK_PROJECTION_TIERS, xp_base: FALLBACK_XP_BASE,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; magA += a[i]*a[i]; magB += b[i]*b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function getMultiplier(sim: number, tiers: MechanicsConfig["projection_tiers"]): number {
  return tiers.find(t => sim >= t.min && sim <= t.max)?.multiplier ?? 0;
}

function getCrossoverLabel(sim: number): string | null {
  if (sim >= 0.90) return "direct";
  if (sim >= 0.60) return "partial";
  if (sim >= 0.30) return "indirect";
  return null;
}

function computeSkillXpToNext(level: number): number {
  if (level === 0) return 50;
  if (level === 1) return 100;
  let result = 100;
  for (let k = 2; k <= level; k++) {
    result *= SKILL_XP_BASE_MULTIPLIER - (SKILL_XP_DECAY_RATE * (k - 2)) / (k + SKILL_XP_DECAY_OFFSET);
  }
  return Math.round(result);
}

function parseVector(v: unknown): number[] {
  if (typeof v === "string") return JSON.parse(v);
  return v as number[];
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "models/gemini-embedding-001", content: { parts: [{ text }] } }) });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  return (await res.json()).embedding.values as number[];
}

async function nameSkillWithLLM(taskTitles: string[], apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  const prompt = `These tasks were completed repeatedly:\n${taskTitles.map(t => `- ${t}`).join("\n")}\n\nName a skill that encompasses them. One to three words maximum. Return only the skill name, nothing else.`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 16 } }) });
  if (!res.ok) throw new Error(`Chat API ${res.status}`);
  return ((await res.json()).candidates?.[0]?.content?.parts?.[0]?.text ?? "New Skill").trim();
}

function updateCentroid(old: number[], newVec: number[], count: number): number[] {
  return old.map((v, i) => (v * count + newVec[i]) / (count + 1));
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const record  = payload?.record ?? payload;
    const taskId: number = record?.id;
    if (!taskId) return new Response("No task id", { status: 400 });

    const GOOGLE_API_KEY       = Deno.env.get("GOOGLE_API_KEY")!;
    const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const config   = await loadConfig(supabase);

    const { data: task, error: taskErr } = await supabase
      .from("task").select("id, title, description, task_type, projection_status, completed_at")
      .eq("id", taskId).single();
    if (taskErr || !task) return new Response("Task not found", { status: 404 });
    if (task.projection_status !== "pending") return new Response("Already processed", { status: 200 });

    const embeddingText = `${task.title} ${task.description ?? ""}`.trim();
    let taskEmbedding: number[];
    try {
      taskEmbedding = await generateEmbedding(embeddingText, GOOGLE_API_KEY);
    } catch (e) {
      console.error("Embedding failed:", e);
      await supabase.from("task").update({ projection_status: "failed" }).eq("id", taskId);
      return new Response("Embedding failed", { status: 500 });
    }

    await supabase.from("task").update({ embedding_vector: taskEmbedding }).eq("id", taskId);

    const taskBaseXp = config.xp_base[task.task_type] ?? 10;
    let anyMatch = false;

    // ── Compare to STATS ───────────────────────────────────────────────────
    // FIXED: select current_value (not current_xp). stat table has current_value from migration 04.
    const { data: stats } = await supabase
      .from("stat").select("id, name, current_value, embedding_vector");

    for (const stat of stats ?? []) {
      if (!stat.embedding_vector) continue;
      const sim = cosineSimilarity(taskEmbedding, parseVector(stat.embedding_vector));
      if (sim < config.stat_match_floor) continue;

      anyMatch = true;
      const multiplier = getMultiplier(sim, config.projection_tiers);
      const xpAmount   = taskBaseXp * multiplier;
      const label      = getCrossoverLabel(sim);

      console.log(`Stat match: ${stat.name} sim=${sim.toFixed(3)} xp+=${xpAmount.toFixed(2)}`);

      // FIXED: update current_value, read from current_value (not current_xp)
      await supabase.from("stat")
        .update({ current_value: (stat.current_value ?? 0) + xpAmount })
        .eq("id", stat.id);

      await supabase.from("xp_ledger").insert({
        source_task_id: taskId, amount: xpAmount, target_type: "stat", target_id: stat.id,
        streak_multiplier_applied: 1.0, arc_multiplier_applied: 1.0, crossover_type: label,
        timestamp: task.completed_at ?? new Date().toISOString(),
      });

      await supabase.from("task_stat").upsert(
        { task_id: taskId, stat_id: stat.id, similarity_score: sim },
        { onConflict: "task_id,stat_id", ignoreDuplicates: true }
      );
      // Streaks: NOT incremented here — EOD cron owns all streak changes.
    }

    // ── Compare to SKILLS ──────────────────────────────────────────────────
    const { data: skills } = await supabase
      .from("skill").select("id, name, current_xp, current_level, xp_to_next, centroid_vector");

    for (const skill of skills ?? []) {
      if (!skill.centroid_vector) continue;
      const sim = cosineSimilarity(taskEmbedding, parseVector(skill.centroid_vector));
      if (sim < config.skill_match_floor) continue;

      anyMatch = true;
      const multiplier = getMultiplier(sim, config.projection_tiers);
      const xpAmount   = taskBaseXp * multiplier;
      const label      = getCrossoverLabel(sim);

      console.log(`Skill match: ${skill.name} sim=${sim.toFixed(3)} xp+=${xpAmount.toFixed(2)}`);

      let newXp      = (skill.current_xp ?? 0) + xpAmount;
      let newLevel   = skill.current_level ?? 0;
      let newXpToNext = skill.xp_to_next ?? 50;
      while (newXp >= newXpToNext) { newXp -= newXpToNext; newLevel++; newXpToNext = computeSkillXpToNext(newLevel); }

      await supabase.from("skill").update({ current_xp: newXp, current_level: newLevel, xp_to_next: newXpToNext }).eq("id", skill.id);

      await supabase.from("xp_ledger").insert({
        source_task_id: taskId, amount: xpAmount, target_type: "skill", target_id: skill.id,
        streak_multiplier_applied: 1.0, arc_multiplier_applied: 1.0, crossover_type: label,
        timestamp: task.completed_at ?? new Date().toISOString(),
      });

      await supabase.from("task_skill").upsert(
        { task_id: taskId, skill_id: skill.id, similarity_score: sim },
        { onConflict: "task_id,skill_id", ignoreDuplicates: true }
      );
      // Streaks: NOT incremented here — EOD cron owns all streak changes.
    }

    if (!anyMatch) {
      await handleSkillCandidate(taskId, taskEmbedding, task, taskBaseXp, config, supabase, GOOGLE_API_KEY);
    }

    await supabase.from("task").update({ projection_status: "done" }).eq("id", taskId);
    console.log(`Task ${taskId} done. anyMatch=${anyMatch}`);
    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("Unhandled:", err);
    return new Response("Internal error", { status: 500 });
  }
});

async function handleSkillCandidate(
  taskId: number, taskEmbedding: number[],
  task: { title: string; description: string | null; completed_at: string | null; task_type: string },
  taskBaseXp: number, config: MechanicsConfig, supabase: ReturnType<typeof createClient>, apiKey: string,
) {
  const { data: candidates } = await supabase.from("skill_candidate").select("cluster_id, cluster_centroid");
  const clusterMap = new Map<string, number[]>();
  for (const row of candidates ?? []) {
    if (row.cluster_centroid) clusterMap.set(row.cluster_id, parseVector(row.cluster_centroid));
  }

  let targetClusterId: string | null = null;
  let nearestDistance = Infinity;
  for (const [cid, centroid] of clusterMap.entries()) {
    const dist = 1 - cosineSimilarity(taskEmbedding, centroid);
    if (dist < nearestDistance) { nearestDistance = dist; targetClusterId = cid; }
  }

  if (targetClusterId !== null && nearestDistance <= config.skill_candidate_max_distance) {
    const existing = clusterMap.get(targetClusterId)!;
    const { count: memberCount } = await supabase.from("skill_candidate")
      .select("id", { count: "exact", head: true }).eq("cluster_id", targetClusterId);
    const count = memberCount ?? 1;
    const newCentroid = updateCentroid(existing, taskEmbedding, count);
    const distToNew   = 1 - cosineSimilarity(taskEmbedding, newCentroid);

    await supabase.from("skill_candidate").insert({ task_id: taskId, cluster_id: targetClusterId, distance_to_centroid: distToNew, cluster_centroid: newCentroid });
    await supabase.from("skill_candidate").update({ cluster_centroid: newCentroid }).eq("cluster_id", targetClusterId).neq("task_id", taskId);

    if ((count + 1) >= config.skill_candidate_threshold) {
      await graduateCluster(targetClusterId, newCentroid, config, supabase, apiKey);
    }
  } else {
    const newClusterId = crypto.randomUUID();
    await supabase.from("skill_candidate").insert({ task_id: taskId, cluster_id: newClusterId, distance_to_centroid: 0, cluster_centroid: taskEmbedding });
    console.log(`New cluster ${newClusterId} for task ${taskId}`);
  }
}

async function graduateCluster(
  clusterId: string, clusterCentroid: number[],
  config: MechanicsConfig, supabase: ReturnType<typeof createClient>, apiKey: string,
) {
  console.log(`Graduating cluster ${clusterId}`);
  const { data: clusterRows } = await supabase.from("skill_candidate").select("task_id").eq("cluster_id", clusterId);
  const taskIds = (clusterRows ?? []).map(r => r.task_id as number);
  if (taskIds.length === 0) return;

  const { data: tasks } = await supabase.from("task")
    .select("id, title, description, task_type, completed_at, embedding_vector").in("id", taskIds);
  const taskTitles = (tasks ?? []).map(t => t.title as string);

  let skillName = "Emerging Skill";
  try { skillName = await nameSkillWithLLM(taskTitles, apiKey); } catch (e) { console.error("Naming failed:", e); }

  const { data: newSkill, error: insertErr } = await supabase.from("skill").insert({
    name: skillName, description: `Auto-generated from tasks: ${taskTitles.join(", ")}`,
    category: "dynamic", is_dynamic: true, origin_task_id: taskIds[0],
    centroid_vector: clusterCentroid, current_xp: 0, current_level: 0, xp_to_next: 50, current_streak: 0,
  }).select("id").single();
  if (insertErr || !newSkill) { console.error("Skill insert failed:", insertErr); return; }

  const skillId = newSkill.id as number;
  await supabase.from("skill_candidate").delete().eq("cluster_id", clusterId);

  for (const t of tasks ?? []) {
    if (!t.embedding_vector) continue;
    const sim = cosineSimilarity(parseVector(t.embedding_vector), parseVector(clusterCentroid));
    if (sim < config.skill_match_floor) continue;
    const multiplier = getMultiplier(sim, config.projection_tiers);
    const xpBase = config.xp_base[t.task_type as string] ?? 10;
    const xpAmount = xpBase * multiplier;

    await supabase.from("task_skill").upsert(
      { task_id: t.id, skill_id: skillId, similarity_score: sim }, { onConflict: "task_id,skill_id", ignoreDuplicates: true });
    await supabase.from("xp_ledger").insert({
      source_task_id: t.id, amount: xpAmount, target_type: "skill", target_id: skillId,
      streak_multiplier_applied: 1.0, arc_multiplier_applied: 1.0, crossover_type: getCrossoverLabel(sim),
      timestamp: t.completed_at ?? new Date().toISOString(),
    });

    const { data: cur } = await supabase.from("skill").select("current_xp, current_level, xp_to_next").eq("id", skillId).single();
    if (cur) {
      let newXp = (cur.current_xp as number) + xpAmount;
      let newLevel = cur.current_level as number;
      let newXpToNext = cur.xp_to_next as number;
      while (newXp >= newXpToNext) { newXp -= newXpToNext; newLevel++; newXpToNext = computeSkillXpToNext(newLevel); }
      await supabase.from("skill").update({ current_xp: newXp, current_level: newLevel, xp_to_next: newXpToNext }).eq("id", skillId);
    }
  }
  console.log(`Graduated → "${skillName}" (id: ${skillId})`);
}
