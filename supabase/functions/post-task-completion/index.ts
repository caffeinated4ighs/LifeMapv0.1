// supabase/functions/post-task-completion/index.ts
//
// Life Map — Phase 6 Embedding Pipeline
// Triggered by DB webhook on task UPDATE when status → 'completed'
//
// Runtime: Deno (Supabase Edge Functions)
// Model:   gemini-embedding-001  (3072 dimensions)
// Chat:    gemini-3.1-flash-lite  (skill graduation naming only)
//
// Environment variables (set in Supabase Edge Function secrets):
//   GOOGLE_API_KEY        — Google AI Studio key
//   SUPABASE_URL          — project URL  (auto-injected by Supabase)
//   SB_SERVICE_KEY        — service role key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────
// Constants (from mechanics.json — hardcoded per integration rule 1)
// ─────────────────────────────────────────────────────────────

const PROJECTION_TIERS = [
  { min: 0.30, max: 0.399, multiplier: 0.1 },
  { min: 0.40, max: 0.499, multiplier: 0.2 },
  { min: 0.50, max: 0.599, multiplier: 0.3 },
  { min: 0.60, max: 0.699, multiplier: 0.4 },
  { min: 0.70, max: 0.799, multiplier: 0.5 },
  { min: 0.80, max: 0.899, multiplier: 0.6 },
  { min: 0.90, max: 0.999, multiplier: 0.7 },
  { min: 1.00, max: 1.001, multiplier: 0.8 }, // 1.001 to catch floating point == 1.0
];

const XP_BASE: Record<string, number> = {
  mandatory: 10,
  habit:     12,
  project:   15,
  bonus:     6,
  anchor:    10, // anchor uses its underlying type; fallback to mandatory base
};

// Skill XP formula constants (skill_xp_formula in mechanics.json)
const SKILL_XP_BASE_MULTIPLIER = 1.030;
const SKILL_XP_DECAY_RATE      = 0.0050;
const SKILL_XP_DECAY_OFFSET    = 55;

// Candidate bucket thresholds
const CANDIDATE_THRESHOLD    = 3;    // tasks before graduation
const CANDIDATE_MAX_DISTANCE = 0.4;  // cosine distance (= 1 - similarity)

// Streak qualifying hit threshold
const STREAK_HIT_THRESHOLD = 0.40;

// ─────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vector dimension mismatch");
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function getMultiplier(similarity: number): number {
  const tier = PROJECTION_TIERS.find(
    (t) => similarity >= t.min && similarity <= t.max
  );
  return tier?.multiplier ?? 0;
}

function getCrossoverLabel(similarity: number): string | null {
  if (similarity >= 0.90) return "direct";
  if (similarity >= 0.60) return "partial";
  if (similarity >= 0.30) return "indirect";
  return null;
}

/**
 * Compute xp_to_next for a given skill level.
 * Level 0→1: 50 XP (special case)
 * Level 1→2: 100 XP (special case)
 * Level N≥2: compound curve
 */
function computeSkillXpToNext(level: number): number {
  if (level === 0) return 50;
  if (level === 1) return 100;
  // Compound curve product for levels 2..N
  let result = 100;
  for (let k = 2; k <= level; k++) {
    result *= SKILL_XP_BASE_MULTIPLIER - (SKILL_XP_DECAY_RATE * (k - 2)) / (k + SKILL_XP_DECAY_OFFSET);
  }
  return Math.round(result);
}

// ─────────────────────────────────────────────────────────────
// Google embedding call (Deno fetch — no npm SDK needed)
// ─────────────────────────────────────────────────────────────

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.embedding.values as number[];
}

// ─────────────────────────────────────────────────────────────
// Google chat call — skill graduation naming only
// ─────────────────────────────────────────────────────────────

async function nameSkillWithLLM(taskTitles: string[], apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  const prompt =
    `These tasks were completed repeatedly:\n${taskTitles.map((t) => `- ${t}`).join("\n")}\n\n` +
    `Name a skill that encompasses them. One to three words maximum. ` +
    `Return only the skill name, nothing else.`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 16 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "New Skill").trim();
}

// ─────────────────────────────────────────────────────────────
// Running centroid update
// ─────────────────────────────────────────────────────────────

function updateCentroid(oldCentroid: number[], newVec: number[], memberCount: number): number[] {
  // Running average: new_centroid = (old * count + new) / (count + 1)
  return oldCentroid.map((v, i) => (v * memberCount + newVec[i]) / (memberCount + 1));
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

    // Supabase DB webhooks send the record directly under `record`
    // Shape: { type: 'UPDATE', table: 'task', record: { id, status, projection_status, ... } }
    const record = payload?.record ?? payload;
    const taskId: number = record?.id;

    if (!taskId) {
      return new Response("No task id in payload", { status: 400 });
    }

    const GOOGLE_API_KEY   = Deno.env.get("GOOGLE_API_KEY")!;
    const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── 1. Fetch task row ──────────────────────────────────────
    const { data: task, error: taskErr } = await supabase
      .from("task")
      .select("id, title, description, task_type, projection_status, completed_at")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) {
      console.error("Task fetch error:", taskErr);
      return new Response("Task not found", { status: 404 });
    }

    // Idempotency guard — only process pending tasks
    if (task.projection_status !== "pending") {
      console.log(`Task ${taskId} already processed (${task.projection_status}). Skipping.`);
      return new Response("Already processed", { status: 200 });
    }

    // ── 2. Generate task embedding ────────────────────────────
    const embeddingText = `${task.title} ${task.description ?? ""}`.trim();
    let taskEmbedding: number[];
    try {
      taskEmbedding = await generateEmbedding(embeddingText, GOOGLE_API_KEY);
    } catch (e) {
      console.error("Embedding generation failed:", e);
      await supabase.from("task").update({ projection_status: "failed" }).eq("id", taskId);
      return new Response("Embedding failed", { status: 500 });
    }

    // Store embedding on task row immediately
    await supabase
      .from("task")
      .update({ embedding_vector: taskEmbedding })
      .eq("id", taskId);

    const taskBaseXp = XP_BASE[task.task_type] ?? 10;

    // Track which skills/stats already had a streak update this invocation
    const streakUpdated = new Set<string>(); // e.g. "stat:3", "skill:7"

    let anyMatch = false;

    // ── 3. Compare to stats ───────────────────────────────────
    const { data: stats } = await supabase
      .from("stat")
      .select("id, name, current_xp, current_streak, embedding_vector");

    for (const stat of stats ?? []) {
      if (!stat.embedding_vector) continue;
      const sim = cosineSimilarity(taskEmbedding, parseVector(stat.embedding_vector));
      if (sim < 0.30) continue;

      anyMatch = true;
      const multiplier = getMultiplier(sim);
      const xpAmount   = taskBaseXp * multiplier;
      const label      = getCrossoverLabel(sim);

      // XP update
      await supabase
        .from("stat")
        .update({ current_xp: stat.current_xp + xpAmount })
        .eq("id", stat.id);

      // xp_ledger entry
      await supabase.from("xp_ledger").insert({
        source_task_id:          taskId,
        amount:                  xpAmount,
        target_type:             "stat",
        target_id:               stat.id,
        streak_multiplier_applied: 1.0,
        arc_multiplier_applied:  1.0,
        crossover_type:          label,
        timestamp:               task.completed_at ?? new Date().toISOString(),
      });

      // task_stat join — ON CONFLICT DO NOTHING via upsert with ignoreDuplicates
      await supabase.from("task_stat").upsert(
        { task_id: taskId, stat_id: stat.id, similarity_score: sim },
        { onConflict: "task_id,stat_id", ignoreDuplicates: true }
      );

      // Streak update (one per stat per invocation, qualifying threshold 0.40)
      const streakKey = `stat:${stat.id}`;
      if (sim >= STREAK_HIT_THRESHOLD && !streakUpdated.has(streakKey)) {
        const newStreak = stat.current_streak < 0 ? 0 : stat.current_streak + 1;
        await supabase.from("stat").update({ current_streak: newStreak }).eq("id", stat.id);
        streakUpdated.add(streakKey);
      }
    }

    // ── 4. Compare to skills ──────────────────────────────────
    const { data: skills } = await supabase
      .from("skill")
      .select("id, name, description, current_xp, current_level, xp_to_next, current_streak, centroid_vector");

    for (const skill of skills ?? []) {
      if (!skill.centroid_vector) continue;
      const sim = cosineSimilarity(taskEmbedding, parseVector(skill.centroid_vector));
      if (sim < 0.30) continue;

      anyMatch = true;
      const multiplier = getMultiplier(sim);
      const xpAmount   = taskBaseXp * multiplier;
      const label      = getCrossoverLabel(sim);

      // XP + possible level-up
      let newXp    = skill.current_xp + xpAmount;
      let newLevel = skill.current_level;
      let newXpToNext = skill.xp_to_next;

      while (newXp >= newXpToNext) {
        newXp -= newXpToNext;
        newLevel += 1;
        newXpToNext = computeSkillXpToNext(newLevel);
      }

      await supabase.from("skill").update({
        current_xp:  newXp,
        current_level: newLevel,
        xp_to_next:  newXpToNext,
      }).eq("id", skill.id);

      // xp_ledger
      await supabase.from("xp_ledger").insert({
        source_task_id:          taskId,
        amount:                  xpAmount,
        target_type:             "skill",
        target_id:               skill.id,
        streak_multiplier_applied: 1.0,
        arc_multiplier_applied:  1.0,
        crossover_type:          label,
        timestamp:               task.completed_at ?? new Date().toISOString(),
      });

      // task_skill join
      await supabase.from("task_skill").upsert(
        { task_id: taskId, skill_id: skill.id, similarity_score: sim },
        { onConflict: "task_id,skill_id", ignoreDuplicates: true }
      );

      // Streak update
      const streakKey = `skill:${skill.id}`;
      if (sim >= STREAK_HIT_THRESHOLD && !streakUpdated.has(streakKey)) {
        const newStreak = skill.current_streak < 0 ? 0 : skill.current_streak + 1;
        await supabase.from("skill").update({ current_streak: newStreak }).eq("id", skill.id);
        streakUpdated.add(streakKey);
      }
    }

    // ── 5. Skill candidate bucket (no match path) ─────────────
    if (!anyMatch) {
      await handleSkillCandidate(taskId, taskEmbedding, task, taskBaseXp, supabase, GOOGLE_API_KEY);
    }

    // ── 6. Mark done ──────────────────────────────────────────
    await supabase
      .from("task")
      .update({ projection_status: "done" })
      .eq("id", taskId);

    console.log(`Task ${taskId} projection complete.`);
    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("Unhandled error:", err);
    // Best-effort: attempt to mark failed if we have a task id
    // (may not always succeed if error occurred before supabase init)
    return new Response("Internal error", { status: 500 });
  }
});

// ─────────────────────────────────────────────────────────────
// Skill candidate bucket handler
// ─────────────────────────────────────────────────────────────

function parseVector(v: unknown): number[] {
  if (typeof v === 'string') return JSON.parse(v)
  return v as number[]
}

async function handleSkillCandidate(
  taskId: number,
  taskEmbedding: number[],
  task: { title: string; description: string | null; completed_at: string | null; task_type: string },
  taskBaseXp: number,
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
) {
  // Fetch all distinct cluster centroids
  const { data: candidates } = await supabase
    .from("skill_candidate")
    .select("cluster_id, cluster_centroid");

  // Deduplicate to one centroid per cluster (take the most recent row's centroid)
  const clusterMap = new Map<string, number[]>();
  for (const row of candidates ?? []) {
    if (row.cluster_centroid) {
      clusterMap.set(row.cluster_id, parseVector(row.cluster_centroid));
    }
  }

  let targetClusterId: string | null = null;
  let nearestDistance = Infinity;

  for (const [clusterId, centroid] of clusterMap.entries()) {
    const parsedCentroid = typeof centroid === 'string'
      ? JSON.parse(centroid)
      : centroid
    const sim = cosineSimilarity(taskEmbedding, parsedCentroid)
    const dist = 1 - sim;
    if (dist < nearestDistance) {
      nearestDistance = dist;
      targetClusterId = clusterId;
    }
  }

  if (targetClusterId !== null && nearestDistance <= CANDIDATE_MAX_DISTANCE) {
    // ── Join existing cluster ──
    const existingCentroid = clusterMap.get(targetClusterId)!;

    // Count current members
    const { count: memberCount } = await supabase
      .from("skill_candidate")
      .select("id", { count: "exact", head: true })
      .eq("cluster_id", targetClusterId);

    const count = memberCount ?? 1;
    const newCentroid = updateCentroid(existingCentroid, taskEmbedding, count);
    const distToNew   = 1 - cosineSimilarity(taskEmbedding, newCentroid);

    // Insert new member row
    await supabase.from("skill_candidate").insert({
      task_id:              taskId,
      cluster_id:           targetClusterId,
      distance_to_centroid: distToNew,
      cluster_centroid:     newCentroid,
    });

    // Update all existing rows in cluster with new centroid
    await supabase
      .from("skill_candidate")
      .update({ cluster_centroid: newCentroid })
      .eq("cluster_id", targetClusterId)
      .neq("task_id", taskId); // don't double-update the row we just inserted

    // Check graduation
    const newMemberCount = count + 1;
    if (newMemberCount >= CANDIDATE_THRESHOLD) {
      await graduateCluster(targetClusterId, newCentroid, taskBaseXp, supabase, apiKey);
    }
  } else {
    // ── Create new cluster ──
    const newClusterId = crypto.randomUUID();
    await supabase.from("skill_candidate").insert({
      task_id:              taskId,
      cluster_id:           newClusterId,
      distance_to_centroid: 0,
      cluster_centroid:     taskEmbedding,
    });
    console.log(`New cluster created: ${newClusterId} for task ${taskId}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Cluster graduation
// ─────────────────────────────────────────────────────────────

async function graduateCluster(
  clusterId: string,
  clusterCentroid: number[],
  _taskBaseXp: number, // unused here but kept for signature clarity
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
) {
  console.log(`Graduating cluster ${clusterId}`);

  // Fetch all task_ids in cluster
  const { data: clusterRows } = await supabase
    .from("skill_candidate")
    .select("task_id")
    .eq("cluster_id", clusterId);

  const taskIds = (clusterRows ?? []).map((r) => r.task_id as number);
  if (taskIds.length === 0) return;

  // Fetch task details for naming
  const { data: tasks } = await supabase
    .from("task")
    .select("id, title, description, task_type, current_xp, completed_at, embedding_vector")
    .in("id", taskIds);

  const taskTitles = (tasks ?? []).map((t) => t.title as string);
  const firstTaskId = taskIds[0];

  // Ask LLM to name the skill
  let skillName = "Emerging Skill";
  try {
    skillName = await nameSkillWithLLM(taskTitles, apiKey);
  } catch (e) {
    console.error("Skill naming failed, using default:", e);
  }

  // Create skill row
  const { data: newSkill, error: skillInsertErr } = await supabase
    .from("skill")
    .insert({
      name:            skillName,
      description:     `Auto-generated from tasks: ${taskTitles.join(", ")}`,
      category:        "dynamic",
      is_dynamic:      true,
      origin_task_id:  firstTaskId,
      centroid_vector: clusterCentroid,
      current_xp:      0,
      current_level:   0,
      xp_to_next:      50, // level 0→1 special case
      current_streak:  0,
    })
    .select("id")
    .single();

  if (skillInsertErr || !newSkill) {
    console.error("Skill insert failed:", skillInsertErr);
    return;
  }

  const skillId = newSkill.id as number;

  // Delete candidate rows for this cluster
  await supabase.from("skill_candidate").delete().eq("cluster_id", clusterId);

  // Backfill task_skill + xp_ledger for all originating tasks
  for (const t of tasks ?? []) {
    if (!t.embedding_vector) continue;

    const sim = cosineSimilarity(parseVector(t.embedding_vector), parseVector(clusterCentroid));
    if (sim < 0.30) continue;

    const multiplier = getMultiplier(sim);
    const xpBase = XP_BASE[t.task_type as string] ?? 10;
    const xpAmount = xpBase * multiplier;
    const label = getCrossoverLabel(sim);

    // task_skill
    await supabase.from("task_skill").upsert(
      { task_id: t.id, skill_id: skillId, similarity_score: sim },
      { onConflict: "task_id,skill_id", ignoreDuplicates: true }
    );

    // xp_ledger (backdated)
    await supabase.from("xp_ledger").insert({
      source_task_id:          t.id,
      amount:                  xpAmount,
      target_type:             "skill",
      target_id:               skillId,
      streak_multiplier_applied: 1.0,
      arc_multiplier_applied:  1.0,
      crossover_type:          label,
      timestamp:               t.completed_at ?? new Date().toISOString(),
    });

    // Accumulate XP on skill
    const { data: currentSkill } = await supabase
      .from("skill")
      .select("current_xp, current_level, xp_to_next")
      .eq("id", skillId)
      .single();

    if (currentSkill) {
      let newXp    = (currentSkill.current_xp as number) + xpAmount;
      let newLevel = currentSkill.current_level as number;
      let newXpToNext = currentSkill.xp_to_next as number;

      while (newXp >= newXpToNext) {
        newXp -= newXpToNext;
        newLevel += 1;
        newXpToNext = computeSkillXpToNext(newLevel);
      }

      await supabase.from("skill").update({
        current_xp:    newXp,
        current_level: newLevel,
        xp_to_next:    newXpToNext,
      }).eq("id", skillId);
    }
  }

  console.log(`Cluster ${clusterId} graduated → skill "${skillName}" (id: ${skillId})`);
}
