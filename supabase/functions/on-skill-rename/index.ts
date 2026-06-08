// supabase/functions/on-skill-rename/index.ts
// Life Map — Skill Rename Handler
//
// CRITICAL FIX vs original:
//   The original version re-embedded the centroid from just the skill name text.
//   e.g. renaming "data entry" → "coding" would set centroid = embed("coding")
//   which is a semantically broad vector that incorrectly matches many tasks.
//
//   A skill's centroid represents the TASKS that founded it, not its label.
//   Renaming should NEVER change the centroid.
//
//   This version: name changes → re-embed for display/search purposes only.
//   centroid_vector is NOT touched on rename.
//
//   If you want to intentionally repoint a skill at a different domain,
//   delete it and let the system re-graduate naturally.
//
// What this function now does:
//   1. Detects name change
//   2. Updates nothing (centroid stays — it represents founding tasks)
//   3. Logs the rename for observability
//   Returns 200 immediately.
//
// Future enhancement: if we add a separate "display_embedding" column
// for semantic search of skills by name, this is where we'd update it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    const payload   = await req.json();
    const record    = payload?.record ?? payload;
    const oldRecord = payload?.old_record;
    const skillId: number = record?.id;

    if (!skillId) return new Response("No skill id", { status: 400 });

    if (oldRecord && record?.name === oldRecord?.name) {
      return new Response("Name unchanged", { status: 200 });
    }

    const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const oldName = oldRecord?.name ?? "(unknown)";
    const newName = record?.name ?? "(unknown)";

    // DO NOT re-embed centroid_vector on rename.
    // The centroid represents the founding task cluster, not the skill label.
    // Re-embedding from the name text corrupts the centroid and causes
    // semantically unrelated tasks to match the skill.
    console.log(`Skill ${skillId} renamed: "${oldName}" → "${newName}". Centroid preserved.`);

    // Optionally log the rename event for auditing
    const { data: skill } = await sb
      .from("skill")
      .select("id, name, description")
      .eq("id", skillId)
      .single();

    if (skill) {
      console.log(`Skill "${skill.name}" centroid unchanged. Description: ${skill.description?.substring(0, 80)}`);
    }

    return new Response("OK — centroid preserved", { status: 200 });

  } catch (e) {
    console.error("Unhandled:", e);
    return new Response("Internal error", { status: 500 });
  }
});
