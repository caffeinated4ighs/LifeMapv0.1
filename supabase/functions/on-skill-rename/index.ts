// supabase/functions/on-skill-rename/index.ts
//
// Life Map — Skill Rename Re-embedding
// Phase 9.2: Reads mechanics config from app_config row (consistent with post-task-completion).
// Triggered by DB webhook on skill UPDATE when name changes.
//
// What it does:
//   1. Fetches mechanics config from app_config
//   2. Generates a new embedding from the updated name + description
//   3. Updates skill.centroid_vector with the new embedding
//
// What it does NOT do:
//   - Touch historical task_skill entries
//   - Recalculate any past XP projections
//
// Environment variables:
//   GOOGLE_API_KEY    — Google AI Studio key
//   SUPABASE_URL      — auto-injected by Supabase
//   SB_SERVICE_KEY    — service role key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();

    const record    = payload?.record ?? payload;
    const oldRecord = payload?.old_record;
    const skillId: number = record?.id;

    if (!skillId) {
      return new Response("No skill id in payload", { status: 400 });
    }

    // Only proceed if name actually changed
    if (oldRecord && record?.name === oldRecord?.name) {
      console.log(`Skill ${skillId}: name unchanged, skipping re-embed.`);
      return new Response("Name unchanged", { status: 200 });
    }

    const GOOGLE_API_KEY       = Deno.env.get("GOOGLE_API_KEY")!;
    const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load mechanics config from DB (same pattern as post-task-completion)
    // On-skill-rename doesn't currently need specific mechanics values,
    // but we fetch the row to stay consistent and future-proof.
    const { data: configRow } = await supabase
      .from("app_config")
      .select("mechanics")
      .eq("id", 1)
      .single();

    const _config = configRow?.mechanics ?? {};
    // (no mechanics values needed for re-embedding, but logged for observability)
    console.log(`Config loaded. skill_match_floor: ${_config.skill_match_floor ?? "fallback"}`);

    // Fetch current skill row for name + description
    const { data: skill, error: skillErr } = await supabase
      .from("skill")
      .select("id, name, description")
      .eq("id", skillId)
      .single();

    if (skillErr || !skill) {
      console.error("Skill fetch error:", skillErr);
      return new Response("Skill not found", { status: 404 });
    }

    const embeddingText = `${skill.name} ${skill.description ?? ""}`.trim();

    let newEmbedding: number[];
    try {
      newEmbedding = await generateEmbedding(embeddingText, GOOGLE_API_KEY);
    } catch (e) {
      console.error("Embedding generation failed:", e);
      return new Response("Embedding failed", { status: 500 });
    }

    const { error: updateErr } = await supabase
      .from("skill")
      .update({ centroid_vector: newEmbedding })
      .eq("id", skillId);

    if (updateErr) {
      console.error("centroid_vector update failed:", updateErr);
      return new Response("DB update failed", { status: 500 });
    }

    console.log(`Skill ${skillId} ("${skill.name}") re-embedded successfully.`);
    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
