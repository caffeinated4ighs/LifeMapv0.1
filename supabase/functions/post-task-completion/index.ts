// supabase/functions/post-task-completion/index.ts
// Life Map — Phase 9.3: Diverging skill tree
//
// NEW in this version:
//   After a task awards XP to a parent skill, a second pass checks whether
//   this task + recent tasks that hit the same parent form a tight sub-cluster.
//   If they do, a child candidate bucket grows under the parent.
//   When enough specific tasks accumulate → a child skill graduates.
//
// Child thresholds (tighter than parent):
//   child_match_floor:            0.75  (vs parent 0.65)
//   child_candidate_threshold:    4     (vs parent 3)
//   child_candidate_max_distance: 0.25  (sim >= 0.75 to join cluster)
//   child_divergence_min:         0.20  (child centroid must differ from parent)
//
// XP flow: a task can award XP to both parent and child simultaneously.
//   "write pytorch attention" → Coding (0.68) + ML (0.84) + Vision (0.91)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Fallbacks (must mirror config/mechanics.json + app_config) ─────────────
const FB = {
  skill_match_floor:            0.65,
  stat_match_floor:             0.40,
  skill_candidate_threshold:    3,
  skill_candidate_max_distance: 0.35,
  child_match_floor:            0.75,
  child_candidate_threshold:    4,
  child_candidate_max_distance: 0.25,
  child_divergence_min:         0.20,
  projection_tiers: [
    { min: 0.30, max: 0.399, multiplier: 0.1 },
    { min: 0.40, max: 0.499, multiplier: 0.2 },
    { min: 0.50, max: 0.599, multiplier: 0.3 },
    { min: 0.60, max: 0.699, multiplier: 0.4 },
    { min: 0.70, max: 0.799, multiplier: 0.5 },
    { min: 0.80, max: 0.899, multiplier: 0.6 },
    { min: 0.90, max: 0.999, multiplier: 0.7 },
    { min: 1.00, max: 1.001, multiplier: 0.8 },
  ],
  xp_base: { mandatory:10, habit:12, project:15, bonus:6, anchor:10, routine:4 } as Record<string,number>,
};

const SKL_MULT  = 1.030;
const SKL_DECAY = 0.0050;
const SKL_OFF   = 55;

type Tier = { min:number; max:number; multiplier:number };
interface Cfg {
  skill_match_floor: number; stat_match_floor: number;
  skill_candidate_threshold: number; skill_candidate_max_distance: number;
  child_match_floor: number; child_candidate_threshold: number;
  child_candidate_max_distance: number; child_divergence_min: number;
  projection_tiers: Tier[]; xp_base: Record<string,number>;
}

async function loadCfg(sb: ReturnType<typeof createClient>): Promise<Cfg> {
  try {
    const { data, error } = await sb.from("app_config").select("mechanics").eq("id",1).single();
    if (error || !data?.mechanics) { console.warn("app_config fallback"); return {...FB}; }
    const m = data.mechanics;
    return {
      skill_match_floor:            m.skill_match_floor            ?? FB.skill_match_floor,
      stat_match_floor:             m.stat_match_floor             ?? FB.stat_match_floor,
      skill_candidate_threshold:    m.skill_candidate_threshold    ?? FB.skill_candidate_threshold,
      skill_candidate_max_distance: m.skill_candidate_max_distance ?? FB.skill_candidate_max_distance,
      child_match_floor:            m.child_match_floor            ?? FB.child_match_floor,
      child_candidate_threshold:    m.child_candidate_threshold    ?? FB.child_candidate_threshold,
      child_candidate_max_distance: m.child_candidate_max_distance ?? FB.child_candidate_max_distance,
      child_divergence_min:         m.child_divergence_min         ?? FB.child_divergence_min,
      projection_tiers:             m.projection_tiers             ?? FB.projection_tiers,
      xp_base:                      m.xp_base                      ?? FB.xp_base,
    };
  } catch(e) { console.error("Config error:",e); return {...FB}; }
}

// ── Math ──────────────────────────────────────────────────────────────────
function cos(a: number[], b: number[]): number {
  let dot=0,mA=0,mB=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];mA+=a[i]*a[i];mB+=b[i]*b[i];}
  const d=Math.sqrt(mA)*Math.sqrt(mB); return d===0?0:dot/d;
}
function getMult(sim:number, tiers:Tier[]): number {
  return tiers.find(t=>sim>=t.min&&sim<=t.max)?.multiplier??0;
}
function xLabel(sim:number): string|null {
  if(sim>=0.90)return"direct"; if(sim>=0.60)return"partial"; if(sim>=0.30)return"indirect"; return null;
}
function xpToNext(level:number): number {
  if(level===0)return 50; if(level===1)return 100;
  let r=100;
  for(let k=2;k<=level;k++) r*=SKL_MULT-(SKL_DECAY*(k-2))/(k+SKL_OFF);
  return Math.round(r);
}
function parseVec(v:unknown): number[] {
  return typeof v==="string"?JSON.parse(v):v as number[];
}
function moveCentroid(old:number[], nw:number[], n:number): number[] {
  return old.map((v,i)=>(v*n+nw[i])/(n+1));
}

// ── Google APIs ────────────────────────────────────────────────────────────
async function embed(text:string, key:string): Promise<number[]> {
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`;
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"models/gemini-embedding-001",content:{parts:[{text}]}})});
  if(!r.ok) throw new Error(`Embed ${r.status}: ${await r.text()}`);
  return (await r.json()).embedding.values as number[];
}
async function nameSkill(titles:string[], key:string): Promise<string> {
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`;
  const prompt=`These tasks were completed repeatedly:\n${titles.map(t=>`- ${t}`).join("\n")}\n\nName a skill (1-3 words). Return only the skill name.`;
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.5,maxOutputTokens:16}})});
  if(!r.ok) throw new Error(`Chat ${r.status}`);
  return((await r.json()).candidates?.[0]?.content?.parts?.[0]?.text??"New Skill").trim();
}

// ── Skill XP award (shared by parent and child paths) ─────────────────────
async function awardSkillXP(
  sb: ReturnType<typeof createClient>,
  taskId: number, skillId: number, xpAmt: number, sim: number,
  completedAt: string | null,
) {
  const {data:cur}=await sb.from("skill")
    .select("current_xp,current_level,xp_to_next").eq("id",skillId).single();
  if(!cur) return;
  let nXp=(cur.current_xp as number)+xpAmt;
  let nLv=cur.current_level as number;
  let nNx=cur.xp_to_next as number;
  while(nXp>=nNx){nXp-=nNx;nLv++;nNx=xpToNext(nLv);}
  await sb.from("skill").update({current_xp:nXp,current_level:nLv,xp_to_next:nNx}).eq("id",skillId);
  await sb.from("xp_ledger").insert({
    source_task_id:taskId, amount:xpAmt, target_type:"skill", target_id:skillId,
    streak_multiplier_applied:1.0, arc_multiplier_applied:1.0, crossover_type:xLabel(sim),
    timestamp:completedAt??new Date().toISOString(),
  });
  await sb.from("task_skill").upsert(
    {task_id:taskId,skill_id:skillId,similarity_score:sim},
    {onConflict:"task_id,skill_id",ignoreDuplicates:true}
  );
}

// ── Child candidate logic ─────────────────────────────────────────────────
// Called for each parent skill that matched the current task.
// Looks at recent tasks that also matched this parent and checks if the
// current task + some of those form a tight sub-cluster.
async function handleChildCandidate(
  sb: ReturnType<typeof createClient>,
  taskId: number, taskVec: number[],
  parentSkillId: number, parentCentroid: number[],
  cfg: Cfg, apiKey: string,
  completedAt: string | null,
) {
  // Get other tasks that matched this parent skill (recent, with embeddings)
  // Limit to last 50 to keep the comparison fast
  const { data: siblingRows } = await sb
    .from("task_skill")
    .select("task_id")
    .eq("skill_id", parentSkillId)
    .neq("task_id", taskId)
    .limit(50);

  if (!siblingRows || siblingRows.length === 0) return;

  const siblingIds = siblingRows.map(r => r.task_id as number);
  const { data: siblingTasks } = await sb
    .from("task")
    .select("id, embedding_vector")
    .in("id", siblingIds)
    .not("embedding_vector", "is", null);

  if (!siblingTasks || siblingTasks.length === 0) return;

  // Find existing child candidate buckets under this parent
  const { data: childCands } = await sb
    .from("skill_candidate")
    .select("cluster_id, cluster_centroid, task_id")
    .eq("parent_skill_id", parentSkillId);

  // Build cluster map (cluster_id → centroid) for child buckets
  const childClusterMap = new Map<string, number[]>();
  for (const row of childCands ?? []) {
    if (row.cluster_centroid && !childClusterMap.has(row.cluster_id)) {
      childClusterMap.set(row.cluster_id, parseVec(row.cluster_centroid));
    }
  }

  // Check if current task joins an existing child cluster
  let bestChildId: string | null = null;
  let bestChildDist = Infinity;
  for (const [cid, cen] of childClusterMap.entries()) {
    const dist = 1 - cos(taskVec, cen);
    if (dist < bestChildDist) { bestChildDist = dist; bestChildId = cid; }
  }

  if (bestChildId !== null && bestChildDist <= cfg.child_candidate_max_distance) {
    // Join existing child cluster
    const existing = childClusterMap.get(bestChildId)!;
    const { count: n } = await sb.from("skill_candidate")
      .select("id", { count: "exact", head: true })
      .eq("cluster_id", bestChildId)
      .eq("parent_skill_id", parentSkillId);
    const count = n ?? 1;
    const newCen = moveCentroid(existing, taskVec, count);
    const newDist = 1 - cos(taskVec, newCen);

    await sb.from("skill_candidate").insert({
      task_id: taskId, cluster_id: bestChildId,
      distance_to_centroid: newDist, cluster_centroid: newCen,
      parent_skill_id: parentSkillId,
    });
    await sb.from("skill_candidate")
      .update({ cluster_centroid: newCen })
      .eq("cluster_id", bestChildId)
      .eq("parent_skill_id", parentSkillId)
      .neq("task_id", taskId);

    console.log(`[child] task ${taskId} joined cluster ${bestChildId} under skill ${parentSkillId} (${count+1}/${cfg.child_candidate_threshold})`);

    if ((count + 1) >= cfg.child_candidate_threshold) {
      // Verify child centroid diverges enough from parent
      const divergence = 1 - cos(newCen, parentCentroid);
      if (divergence >= cfg.child_divergence_min) {
        await graduateChildSkill(bestChildId, newCen, parentSkillId, cfg, sb, apiKey, completedAt);
      } else {
        console.log(`[child] cluster ${bestChildId} too similar to parent (divergence=${divergence.toFixed(3)} < ${cfg.child_divergence_min}) — not graduating`);
      }
    }
    return;
  }

  // No existing child cluster fits — check if current task + siblings
  // form a new tight sub-cluster
  const closeSiblings: Array<{ id: number; vec: number[] }> = [];
  for (const st of siblingTasks) {
    if (!st.embedding_vector) continue;
    const vec = parseVec(st.embedding_vector);
    const sim = cos(taskVec, vec);
    if (sim >= cfg.child_match_floor) {
      closeSiblings.push({ id: st.id as number, vec });
    }
  }

  if (closeSiblings.length === 0) return; // no tight siblings, no new cluster yet

  // Compute provisional centroid of {currentTask, closeSiblings}
  const allVecs = [taskVec, ...closeSiblings.map(s => s.vec)];
  const provisionalCen = allVecs[0].map((_, i) =>
    allVecs.reduce((sum, v) => sum + v[i], 0) / allVecs.length
  );

  // Check divergence from parent before creating cluster
  const divergence = 1 - cos(provisionalCen, parentCentroid);
  if (divergence < cfg.child_divergence_min) {
    console.log(`[child] provisional cluster too similar to parent ${parentSkillId} (divergence=${divergence.toFixed(3)}) — skipping`);
    return;
  }

  // Create new child candidate cluster
  const newClusterId = crypto.randomUUID();
  const dist = 1 - cos(taskVec, provisionalCen);

  await sb.from("skill_candidate").insert({
    task_id: taskId, cluster_id: newClusterId,
    distance_to_centroid: dist, cluster_centroid: provisionalCen,
    parent_skill_id: parentSkillId,
  });

  console.log(`[child] new child cluster ${newClusterId} under skill ${parentSkillId} with ${closeSiblings.length} sibling(s) nearby`);
}

// ── Graduate child skill ──────────────────────────────────────────────────
async function graduateChildSkill(
  clusterId: string, centroid: number[],
  parentSkillId: number, cfg: Cfg,
  sb: ReturnType<typeof createClient>, apiKey: string,
  completedAt: string | null,
) {
  console.log(`[child] graduating cluster ${clusterId} as child of skill ${parentSkillId}`);

  const { data: rows } = await sb.from("skill_candidate")
    .select("task_id")
    .eq("cluster_id", clusterId)
    .eq("parent_skill_id", parentSkillId);
  const taskIds = (rows ?? []).map(r => r.task_id as number);
  if (!taskIds.length) return;

  const { data: tasks } = await sb.from("task")
    .select("id, title, description, task_type, completed_at, embedding_vector")
    .in("id", taskIds);
  const titles = (tasks ?? []).map(t => t.title as string);

  let skillName = "Specialization";
  try { skillName = await nameSkill(titles, apiKey); } catch(e) { console.error("Naming failed:", e); }

  const { data: newSkill, error } = await sb.from("skill").insert({
    name: skillName,
    description: `Child of skill ${parentSkillId}. Auto-generated from: ${titles.join(", ")}`,
    category: "dynamic", is_dynamic: true,
    parent_skill_id: parentSkillId,          // ← links to parent
    origin_task_id: taskIds[0],
    centroid_vector: centroid,
    current_xp: 0, current_level: 0, xp_to_next: 50, current_streak: 0,
  }).select("id").single();

  if (error || !newSkill) { console.error("Child skill insert failed:", error); return; }

  const sid = newSkill.id as number;
  await sb.from("skill_candidate")
    .delete()
    .eq("cluster_id", clusterId)
    .eq("parent_skill_id", parentSkillId);

  // Backfill XP for founding tasks
  for (const t of tasks ?? []) {
    if (!t.embedding_vector) continue;
    const sim = cos(parseVec(t.embedding_vector), centroid);
    if (sim < cfg.child_match_floor) continue;
    const xpAmt = (cfg.xp_base[t.task_type as string] ?? 10) * getMult(sim, cfg.projection_tiers);
    await awardSkillXP(sb, t.id as number, sid, xpAmt, sim, t.completed_at as string | null);
  }

  console.log(`[child] graduated → child skill "${skillName}" (id:${sid}) under parent ${parentSkillId}`);
}

// ── Top-level candidate bucket (no parent match) ───────────────────────────
async function handleTopLevelCandidate(
  taskId: number, taskVec: number[],
  task: { title:string; description:string|null; completed_at:string|null; task_type:string },
  baseXp: number, cfg: Cfg, sb: ReturnType<typeof createClient>, apiKey: string,
) {
  // Only top-level candidates (parent_skill_id IS NULL)
  const { data: cands } = await sb.from("skill_candidate")
    .select("cluster_id, cluster_centroid")
    .is("parent_skill_id", null);

  const clusterMap = new Map<string, number[]>();
  for (const row of cands ?? []) {
    if (row.cluster_centroid && !clusterMap.has(row.cluster_id)) {
      clusterMap.set(row.cluster_id, parseVec(row.cluster_centroid));
    }
  }

  let bestId: string|null = null; let bestDist = Infinity;
  for (const [cid, cen] of clusterMap.entries()) {
    const dist = 1 - cos(taskVec, cen);
    if (dist < bestDist) { bestDist = dist; bestId = cid; }
  }

  if (bestId !== null && bestDist <= cfg.skill_candidate_max_distance) {
    const existing = clusterMap.get(bestId)!;
    const { count: n } = await sb.from("skill_candidate")
      .select("id", { count:"exact", head:true })
      .eq("cluster_id", bestId)
      .is("parent_skill_id", null);
    const count = n ?? 1;
    const newCen = moveCentroid(existing, taskVec, count);
    const newDist = 1 - cos(taskVec, newCen);

    await sb.from("skill_candidate").insert({
      task_id:taskId, cluster_id:bestId,
      distance_to_centroid:newDist, cluster_centroid:newCen,
      parent_skill_id: null,
    });
    await sb.from("skill_candidate")
      .update({cluster_centroid:newCen})
      .eq("cluster_id",bestId).is("parent_skill_id",null).neq("task_id",taskId);

    console.log(`[top] task ${taskId} joined cluster ${bestId} (${count+1}/${cfg.skill_candidate_threshold})`);
    if ((count+1) >= cfg.skill_candidate_threshold) {
      await graduateTopSkill(bestId, newCen, cfg, sb, apiKey, task.completed_at);
    }
  } else {
    const newId = crypto.randomUUID();
    await sb.from("skill_candidate").insert({
      task_id:taskId, cluster_id:newId,
      distance_to_centroid:0, cluster_centroid:taskVec,
      parent_skill_id: null,
    });
    console.log(`[top] new cluster ${newId} for task ${taskId}`);
  }
}

async function graduateTopSkill(
  clusterId: string, centroid: number[],
  cfg: Cfg, sb: ReturnType<typeof createClient>, apiKey: string,
  completedAt: string | null,
) {
  console.log(`[top] graduating cluster ${clusterId}`);
  const { data: rows } = await sb.from("skill_candidate")
    .select("task_id").eq("cluster_id", clusterId).is("parent_skill_id", null);
  const taskIds = (rows ?? []).map(r => r.task_id as number);
  if (!taskIds.length) return;

  const { data: tasks } = await sb.from("task")
    .select("id, title, description, task_type, completed_at, embedding_vector").in("id", taskIds);
  const titles = (tasks ?? []).map(t => t.title as string);

  let skillName = "Emerging Skill";
  try { skillName = await nameSkill(titles, apiKey); } catch(e) { console.error("Naming failed:", e); }

  const { data: newSkill, error } = await sb.from("skill").insert({
    name: skillName,
    description: `Auto-generated from: ${titles.join(", ")}`,
    category: "dynamic", is_dynamic: true,
    parent_skill_id: null,                   // top-level skill
    origin_task_id: taskIds[0],
    centroid_vector: centroid,
    current_xp: 0, current_level: 0, xp_to_next: 50, current_streak: 0,
  }).select("id").single();

  if (error || !newSkill) { console.error("Skill insert failed:", error); return; }

  const sid = newSkill.id as number;
  await sb.from("skill_candidate").delete().eq("cluster_id", clusterId).is("parent_skill_id", null);

  for (const t of tasks ?? []) {
    if (!t.embedding_vector) continue;
    const sim = cos(parseVec(t.embedding_vector), centroid);
    if (sim < cfg.skill_match_floor) continue;
    const xpAmt = (cfg.xp_base[t.task_type as string] ?? 10) * getMult(sim, cfg.projection_tiers);
    await awardSkillXP(sb, t.id as number, sid, xpAmt, sim, t.completed_at as string | null);
  }

  console.log(`[top] graduated → skill "${skillName}" (id:${sid})`);
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
    const cfg  = await loadCfg(sb);

    console.log(`[task ${taskId}] floors: skill=${cfg.skill_match_floor} stat=${cfg.stat_match_floor} child=${cfg.child_match_floor}`);

    const { data: task, error: tErr } = await sb.from("task")
      .select("id, title, description, task_type, projection_status, completed_at")
      .eq("id", taskId).single();
    if (tErr || !task) return new Response("Task not found", { status: 404 });
    if (task.projection_status !== "pending") return new Response("Already processed", { status: 200 });

    const embedText = `${task.title} ${task.description ?? ""}`.trim();
    let taskVec: number[];
    try { taskVec = await embed(embedText, GKEY); }
    catch (e) {
      console.error("Embed failed:", e);
      await sb.from("task").update({ projection_status: "failed" }).eq("id", taskId);
      return new Response("Embed failed", { status: 500 });
    }
    await sb.from("task").update({ embedding_vector: taskVec }).eq("id", taskId);

    const baseXp = cfg.xp_base[task.task_type] ?? 10;
    let anyMatch = false;

    // ── Stats ─────────────────────────────────────────────────────────────
    const { data: stats } = await sb.from("stat")
      .select("id, name, current_value, embedding_vector");
    for (const s of stats ?? []) {
      if (!s.embedding_vector) continue;
      const sim = cos(taskVec, parseVec(s.embedding_vector));
      if (sim < cfg.stat_match_floor) continue;
      anyMatch = true;
      const xpAmt = baseXp * getMult(sim, cfg.projection_tiers);
      console.log(`[task ${taskId}] stat "${s.name}" sim=${sim.toFixed(3)} +${xpAmt.toFixed(2)}`);
      await sb.from("stat").update({ current_value: (s.current_value ?? 0) + xpAmt }).eq("id", s.id);
      await sb.from("xp_ledger").insert({
        source_task_id:taskId, amount:xpAmt, target_type:"stat", target_id:s.id,
        streak_multiplier_applied:1.0, arc_multiplier_applied:1.0, crossover_type:xLabel(sim),
        timestamp:task.completed_at??new Date().toISOString(),
      });
      await sb.from("task_stat").upsert(
        {task_id:taskId,stat_id:s.id,similarity_score:sim},
        {onConflict:"task_id,stat_id",ignoreDuplicates:true}
      );
    }

    // ── Skills (parent + child check) ─────────────────────────────────────
    const { data: skills } = await sb.from("skill")
      .select("id, name, current_xp, current_level, xp_to_next, centroid_vector");
    
    const matchedSkills: Array<{ id: number; centroid: number[]; sim: number }> = [];

    for (const sk of skills ?? []) {
      if (!sk.centroid_vector) continue;
      const sim = cos(taskVec, parseVec(sk.centroid_vector));
      console.log(`[task ${taskId}] skill "${sk.name}" sim=${sim.toFixed(3)}`);
      if (sim < cfg.skill_match_floor) continue;

      anyMatch = true;
      const xpAmt = baseXp * getMult(sim, cfg.projection_tiers);
      console.log(`[task ${taskId}] → skill "${sk.name}" +${xpAmt.toFixed(2)} XP (${xLabel(sim)})`);
      await awardSkillXP(sb, taskId, sk.id as number, xpAmt, sim, task.completed_at as string | null);

      matchedSkills.push({ id: sk.id as number, centroid: parseVec(sk.centroid_vector), sim });
    }

    // ── Child candidate check for each matched skill ───────────────────────
    // Only runs for top-level skills (no parent) — avoids infinite nesting for now.
    // Future: could allow grandchildren by checking parent_skill_id IS NULL.
    if (matchedSkills.length > 0) {
      const { data: skillDetails } = await sb.from("skill")
        .select("id, parent_skill_id")
        .in("id", matchedSkills.map(s => s.id));

      for (const ms of matchedSkills) {
        const detail = skillDetails?.find(d => d.id === ms.id);
        // Only generate children from top-level skills (no grandchildren yet)
        if (detail?.parent_skill_id !== null && detail?.parent_skill_id !== undefined) continue;

        await handleChildCandidate(
          sb, taskId, taskVec, ms.id, ms.centroid, cfg, GKEY, task.completed_at as string | null
        );
      }
    }

    // ── Top-level candidate bucket (no skill matched at all) ───────────────
    if (!anyMatch) {
      console.log(`[task ${taskId}] no match — top-level candidate bucket`);
      await handleTopLevelCandidate(taskId, taskVec, task, baseXp, cfg, sb, GKEY);
    }

    await sb.from("task").update({ projection_status: "done" }).eq("id", taskId);
    console.log(`[task ${taskId}] done. anyMatch=${anyMatch} matchedSkills=${matchedSkills.length}`);
    return new Response("OK", { status: 200 });

  } catch(e) {
    console.error("Unhandled:", e);
    return new Response("Internal error", { status: 500 });
  }
});
