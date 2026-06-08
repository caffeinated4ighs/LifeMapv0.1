// supabase/functions/post-task-completion/index.ts
// Life Map — Phase 9.2 final
//
// Key thresholds (read from app_config, fallbacks match mechanics.json):
//   skill_match_floor:            0.65  (was 0.30 — this was the bug)
//   stat_match_floor:             0.40  (broader, stats are categorical)
//   skill_candidate_max_distance: 0.35  (= similarity >= 0.65 to join cluster)
//
// Streak changes: REMOVED — EOD cron owns all streak increments/decrements.
// stat column:    current_value (NOT current_xp — matches migration 04 schema)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Fallbacks (must mirror config/mechanics.json exactly) ─────────────────
const FB_SKILL_FLOOR      = 0.65;  // was 0.30 in old version — THE BUG
const FB_STAT_FLOOR       = 0.40;
const FB_CANDIDATE_THRESH = 3;
const FB_CANDIDATE_DIST   = 0.35;  // tighter than old 0.40

const FB_TIERS = [
  { min: 0.30, max: 0.399, multiplier: 0.1 },
  { min: 0.40, max: 0.499, multiplier: 0.2 },
  { min: 0.50, max: 0.599, multiplier: 0.3 },
  { min: 0.60, max: 0.699, multiplier: 0.4 },
  { min: 0.70, max: 0.799, multiplier: 0.5 },
  { min: 0.80, max: 0.899, multiplier: 0.6 },
  { min: 0.90, max: 0.999, multiplier: 0.7 },
  { min: 1.00, max: 1.001, multiplier: 0.8 },
];

const FB_XP_BASE: Record<string, number> = {
  mandatory: 10, habit: 12, project: 15, bonus: 6, anchor: 10, routine: 4,
};

// Skill XP formula (mirrors mechanics.json skill_xp_formula)
const SKL_MULT  = 1.030;
const SKL_DECAY = 0.0050;
const SKL_OFF   = 55;

interface Config {
  skill_match_floor: number;
  stat_match_floor: number;
  skill_candidate_threshold: number;
  skill_candidate_max_distance: number;
  projection_tiers: Array<{ min: number; max: number; multiplier: number }>;
  xp_base: Record<string, number>;
}

async function loadConfig(sb: ReturnType<typeof createClient>): Promise<Config> {
  try {
    const { data, error } = await sb.from("app_config").select("mechanics").eq("id", 1).single();
    if (error || !data?.mechanics) { console.warn("app_config fallback:", error?.message); return fb(); }
    const m = data.mechanics;
    return {
      skill_match_floor:            m.skill_match_floor            ?? FB_SKILL_FLOOR,
      stat_match_floor:             m.stat_match_floor             ?? FB_STAT_FLOOR,
      skill_candidate_threshold:    m.skill_candidate_threshold    ?? FB_CANDIDATE_THRESH,
      skill_candidate_max_distance: m.skill_candidate_max_distance ?? FB_CANDIDATE_DIST,
      projection_tiers:             m.projection_tiers             ?? FB_TIERS,
      xp_base:                      m.xp_base                      ?? FB_XP_BASE,
    };
  } catch (e) { console.error("Config error:", e); return fb(); }
}

function fb(): Config {
  return {
    skill_match_floor: FB_SKILL_FLOOR, stat_match_floor: FB_STAT_FLOOR,
    skill_candidate_threshold: FB_CANDIDATE_THRESH, skill_candidate_max_distance: FB_CANDIDATE_DIST,
    projection_tiers: FB_TIERS, xp_base: FB_XP_BASE,
  };
}

function cos(a: number[], b: number[]): number {
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i]; }
  const d = Math.sqrt(mA) * Math.sqrt(mB);
  return d === 0 ? 0 : dot / d;
}

function mult(sim: number, tiers: Config["projection_tiers"]): number {
  return tiers.find(t => sim >= t.min && sim <= t.max)?.multiplier ?? 0;
}

function label(sim: number): string | null {
  if (sim >= 0.90) return "direct";
  if (sim >= 0.60) return "partial";
  if (sim >= 0.30) return "indirect";
  return null;
}

function xpToNext(level: number): number {
  if (level === 0) return 50;
  if (level === 1) return 100;
  let r = 100;
  for (let k = 2; k <= level; k++) r *= SKL_MULT - (SKL_DECAY * (k-2)) / (k + SKL_OFF);
  return Math.round(r);
}

function parseVec(v: unknown): number[] {
  return typeof v === "string" ? JSON.parse(v) : v as number[];
}

async function embed(text: string, key: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`;
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "models/gemini-embedding-001", content: { parts: [{ text }] } }),
  });
  if (!r.ok) throw new Error(`Embed ${r.status}: ${await r.text()}`);
  return (await r.json()).embedding.values as number[];
}

async function nameSkill(titles: string[], key: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`;
  const prompt = `These tasks were completed repeatedly:\n${titles.map(t => `- ${t}`).join("\n")}\n\nName a skill that encompasses them. One to three words. Return only the skill name.`;
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role:"user", parts:[{text:prompt}] }], generationConfig:{temperature:0.5,maxOutputTokens:16} }),
  });
  if (!r.ok) throw new Error(`Chat ${r.status}`);
  return ((await r.json()).candidates?.[0]?.content?.parts?.[0]?.text ?? "New Skill").trim();
}

function moveCentroid(old: number[], nw: number[], n: number): number[] {
  return old.map((v, i) => (v * n + nw[i]) / (n + 1));
}

// ── Main ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const record  = payload?.record ?? payload;
    const taskId: number = record?.id;
    if (!taskId) return new Response("No task id", { status: 400 });

    const GKEY = Deno.env.get("GOOGLE_API_KEY")!;
    const SURL = Deno.env.get("SUPABASE_URL")!;
    const SKEY = Deno.env.get("SB_SERVICE_KEY")!;
    const sb   = createClient(SURL, SKEY);
    const cfg  = await loadConfig(sb);

    console.log(`[task ${taskId}] config: skill_floor=${cfg.skill_match_floor} stat_floor=${cfg.stat_match_floor} candidate_dist=${cfg.skill_candidate_max_distance}`);

    const { data: task, error: tErr } = await sb.from("task")
      .select("id, title, description, task_type, projection_status, completed_at")
      .eq("id", taskId).single();
    if (tErr || !task) return new Response("Task not found", { status: 404 });
    if (task.projection_status !== "pending") return new Response("Already processed", { status: 200 });

    const embedText = `${task.title} ${task.description ?? ""}`.trim();
    let taskVec: number[];
    try {
      taskVec = await embed(embedText, GKEY);
    } catch (e) {
      console.error("Embed failed:", e);
      await sb.from("task").update({ projection_status: "failed" }).eq("id", taskId);
      return new Response("Embed failed", { status: 500 });
    }
    await sb.from("task").update({ embedding_vector: taskVec }).eq("id", taskId);

    const baseXp  = cfg.xp_base[task.task_type] ?? 10;
    let anyMatch  = false;

    // ── Stats ────────────────────────────────────────────────────────────
    // FIXED: select current_value (migration 04 column, not current_xp)
    const { data: stats } = await sb.from("stat").select("id, name, current_value, embedding_vector");
    for (const s of stats ?? []) {
      if (!s.embedding_vector) continue;
      const sim = cos(taskVec, parseVec(s.embedding_vector));
      console.log(`[task ${taskId}] stat "${s.name}" sim=${sim.toFixed(3)} floor=${cfg.stat_match_floor} pass=${sim >= cfg.stat_match_floor}`);
      if (sim < cfg.stat_match_floor) continue;

      anyMatch = true;
      const xpAmt = baseXp * mult(sim, cfg.projection_tiers);
      console.log(`[task ${taskId}] → stat "${s.name}" +${xpAmt.toFixed(2)} XP (${label(sim)})`);

      // FIXED: update current_value (not current_xp)
      await sb.from("stat").update({ current_value: (s.current_value ?? 0) + xpAmt }).eq("id", s.id);
      await sb.from("xp_ledger").insert({
        source_task_id: taskId, amount: xpAmt, target_type: "stat", target_id: s.id,
        streak_multiplier_applied: 1.0, arc_multiplier_applied: 1.0, crossover_type: label(sim),
        timestamp: task.completed_at ?? new Date().toISOString(),
      });
      await sb.from("task_stat").upsert(
        { task_id: taskId, stat_id: s.id, similarity_score: sim },
        { onConflict: "task_id,stat_id", ignoreDuplicates: true }
      );
      // Streaks owned by EOD cron — not touched here
    }

    // ── Skills ───────────────────────────────────────────────────────────
    const { data: skills } = await sb.from("skill")
      .select("id, name, current_xp, current_level, xp_to_next, centroid_vector");
    for (const sk of skills ?? []) {
      if (!sk.centroid_vector) continue;
      const sim = cos(taskVec, parseVec(sk.centroid_vector));
      console.log(`[task ${taskId}] skill "${sk.name}" sim=${sim.toFixed(3)} floor=${cfg.skill_match_floor} pass=${sim >= cfg.skill_match_floor}`);
      if (sim < cfg.skill_match_floor) continue;

      anyMatch = true;
      const xpAmt = baseXp * mult(sim, cfg.projection_tiers);
      console.log(`[task ${taskId}] → skill "${sk.name}" +${xpAmt.toFixed(2)} XP (${label(sim)})`);

      let nXp = (sk.current_xp ?? 0) + xpAmt;
      let nLv = sk.current_level ?? 0;
      let nNx = sk.xp_to_next ?? 50;
      while (nXp >= nNx) { nXp -= nNx; nLv++; nNx = xpToNext(nLv); }

      await sb.from("skill").update({ current_xp: nXp, current_level: nLv, xp_to_next: nNx }).eq("id", sk.id);
      await sb.from("xp_ledger").insert({
        source_task_id: taskId, amount: xpAmt, target_type: "skill", target_id: sk.id,
        streak_multiplier_applied: 1.0, arc_multiplier_applied: 1.0, crossover_type: label(sim),
        timestamp: task.completed_at ?? new Date().toISOString(),
      });
      await sb.from("task_skill").upsert(
        { task_id: taskId, skill_id: sk.id, similarity_score: sim },
        { onConflict: "task_id,skill_id", ignoreDuplicates: true }
      );
      // Streaks owned by EOD cron — not touched here
    }

    // ── Candidate bucket (no match) ───────────────────────────────────────
    if (!anyMatch) {
      console.log(`[task ${taskId}] no match — entering candidate bucket`);
      await handleCandidate(taskId, taskVec, task, baseXp, cfg, sb, GKEY);
    }

    await sb.from("task").update({ projection_status: "done" }).eq("id", taskId);
    console.log(`[task ${taskId}] projection complete. anyMatch=${anyMatch}`);
    return new Response("OK", { status: 200 });

  } catch (e) {
    console.error("Unhandled:", e);
    return new Response("Internal error", { status: 500 });
  }
});

// ── Candidate bucket ──────────────────────────────────────────────────────
async function handleCandidate(
  taskId: number, taskVec: number[],
  task: { title: string; description: string | null; completed_at: string | null; task_type: string },
  baseXp: number, cfg: Config, sb: ReturnType<typeof createClient>, apiKey: string,
) {
  const { data: cands } = await sb.from("skill_candidate").select("cluster_id, cluster_centroid");
  const clusterMap = new Map<string, number[]>();
  for (const row of cands ?? []) {
    if (row.cluster_centroid) clusterMap.set(row.cluster_id, parseVec(row.cluster_centroid));
  }

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const [cid, cen] of clusterMap.entries()) {
    const dist = 1 - cos(taskVec, cen);
    console.log(`[task ${taskId}] cluster ${cid} dist=${dist.toFixed(3)} max=${cfg.skill_candidate_max_distance}`);
    if (dist < bestDist) { bestDist = dist; bestId = cid; }
  }

  if (bestId !== null && bestDist <= cfg.skill_candidate_max_distance) {
    const existing = clusterMap.get(bestId)!;
    const { count: n } = await sb.from("skill_candidate")
      .select("id", { count: "exact", head: true }).eq("cluster_id", bestId);
    const count    = n ?? 1;
    const newCen   = moveCentroid(existing, taskVec, count);
    const newDist  = 1 - cos(taskVec, newCen);

    await sb.from("skill_candidate").insert({ task_id: taskId, cluster_id: bestId, distance_to_centroid: newDist, cluster_centroid: newCen });
    await sb.from("skill_candidate").update({ cluster_centroid: newCen }).eq("cluster_id", bestId).neq("task_id", taskId);

    console.log(`[task ${taskId}] joined cluster ${bestId} (${count+1}/${cfg.skill_candidate_threshold} tasks)`);
    if ((count + 1) >= cfg.skill_candidate_threshold) {
      await graduate(bestId, newCen, cfg, sb, apiKey);
    }
  } else {
    const newId = crypto.randomUUID();
    await sb.from("skill_candidate").insert({ task_id: taskId, cluster_id: newId, distance_to_centroid: 0, cluster_centroid: taskVec });
    console.log(`[task ${taskId}] new cluster ${newId}`);
  }
}

// ── Graduation ────────────────────────────────────────────────────────────
async function graduate(
  clusterId: string, centroid: number[],
  cfg: Config, sb: ReturnType<typeof createClient>, apiKey: string,
) {
  console.log(`Graduating cluster ${clusterId}`);
  const { data: rows } = await sb.from("skill_candidate").select("task_id").eq("cluster_id", clusterId);
  const taskIds = (rows ?? []).map(r => r.task_id as number);
  if (!taskIds.length) return;

  const { data: tasks } = await sb.from("task")
    .select("id, title, description, task_type, completed_at, embedding_vector").in("id", taskIds);
  const titles = (tasks ?? []).map(t => t.title as string);

  let skillName = "Emerging Skill";
  try { skillName = await nameSkill(titles, apiKey); } catch (e) { console.error("Naming failed:", e); }
  console.log(`Graduating → "${skillName}"`);

  const { data: newSkill, error } = await sb.from("skill").insert({
    name: skillName, description: `Auto-generated from: ${titles.join(", ")}`,
    category: "dynamic", is_dynamic: true, origin_task_id: taskIds[0],
    centroid_vector: centroid, current_xp: 0, current_level: 0, xp_to_next: 50, current_streak: 0,
  }).select("id").single();
  if (error || !newSkill) { console.error("Skill insert failed:", error); return; }

  const sid = newSkill.id as number;
  await sb.from("skill_candidate").delete().eq("cluster_id", clusterId);

  for (const t of tasks ?? []) {
    if (!t.embedding_vector) continue;
    const sim = cos(parseVec(t.embedding_vector), parseVec(centroid));
    if (sim < cfg.skill_match_floor) continue;
    const xpAmt = (cfg.xp_base[t.task_type as string] ?? 10) * mult(sim, cfg.projection_tiers);

    await sb.from("task_skill").upsert({ task_id: t.id, skill_id: sid, similarity_score: sim }, { onConflict: "task_id,skill_id", ignoreDuplicates: true });
    await sb.from("xp_ledger").insert({
      source_task_id: t.id, amount: xpAmt, target_type: "skill", target_id: sid,
      streak_multiplier_applied: 1.0, arc_multiplier_applied: 1.0, crossover_type: label(sim),
      timestamp: t.completed_at ?? new Date().toISOString(),
    });

    const { data: cur } = await sb.from("skill").select("current_xp, current_level, xp_to_next").eq("id", sid).single();
    if (cur) {
      let nXp = (cur.current_xp as number) + xpAmt;
      let nLv = cur.current_level as number;
      let nNx = cur.xp_to_next as number;
      while (nXp >= nNx) { nXp -= nNx; nLv++; nNx = xpToNext(nLv); }
      await sb.from("skill").update({ current_xp: nXp, current_level: nLv, xp_to_next: nNx }).eq("id", sid);
    }
  }
  console.log(`Graduated → skill "${skillName}" (id: ${sid})`);
}
