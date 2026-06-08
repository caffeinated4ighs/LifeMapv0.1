# Life Map — Frontend Guide
**Version:** 2.0 (Phase 9.2)
**Base URL:** `http://localhost:3001` (dev) / your Render URL (prod)
**Auth:** None — single-user app. All endpoints are open.

---

## Overview

The Life Map API is a thin JSON REST layer over a Supabase Postgres database.
All write operations that touch game state go through the server — never
directly to Supabase from the browser.

---

## Endpoints

### `GET /config`
Returns mechanics and theme configuration. Call at boot and store in
`window.LIFEMAP_CONFIG`. Use this instead of hardcoding reward values.

**Response:**
```json
{
  "mechanics": {
    "xp_base": { "mandatory": 10, "habit": 12, "project": 15, "bonus": 6, "anchor": 10, "routine": 4 },
    "gold_base": { "P0": 15, "P1": 10, "P2": 6, "P3": 3 },
    "gold_difficulty_offset": { "low": -2, "medium": 0, "high": 5 },
    "gold_floor": 1,
    "gold_base_routine": 2,
    "energy_drain_base": { "mandatory": 8, "habit": 6, "project": 10, "bonus": 3, "anchor": 10, "routine": 2 },
    "energy_drain_floor": 1,
    "skill_match_floor": 0.65,
    "streak_hit_threshold": 0.55
  },
  "theme": {
    "colors": { "accent": "#4f8ef7", ... },
    "fonts": { "primary": "Inter, system-ui, sans-serif", "mono": "JetBrains Mono, monospace" }
  }
}
```

---

### `GET /state`
Returns current player state for the navbar. Poll on user action or every 60s.

**Response:**
```json
{
  "level": 4,
  "current_xp": 340,
  "xp_to_next": 500,
  "total_gold": 120,
  "available_gold": 82,
  "energy": {
    "current": 75,
    "max": 100,
    "threshold_label": "normal"
  },
  "streak": {
    "day_streak": 5,
    "mandatory_met": false,
    "streak_multiplier": 0.095,
    "day_off_granted": false
  },
  "day_off_granted": false
}
```

`threshold_label` values: `"normal"` | `"reduced"` | `"min_viable"` | `"recovery"`

---

### `GET /tasks`
Returns tasks for a given date. Defaults to today.

**Query params:**
- `date` — `YYYY-MM-DD` (optional, defaults to today)

**Today's response** includes:
- Tasks scheduled for today
- Unscheduled pending tasks (no `scheduled_at`, no `time_block`)
- Routine tasks filtered by passed time blocks
- Excludes tasks completed before today

**Historical response** (any `date` ≠ today):
- Tasks scheduled on that date
- Tasks completed on that date

**Response:** Array of task objects:
```json
[
  {
    "id": 42,
    "title": "Morning run",
    "task_type": "habit",
    "priority": "P1",
    "difficulty": "medium",
    "status": "pending",
    "time_block": "morning",
    "scheduled_at": null,
    "completed_at": null,
    "is_recovery": false,
    "late_multiplier": 1.0,
    "arc_id": null,
    "description": "30-minute outdoor run to build cardiovascular endurance.",
    "created_at": "2026-06-01T10:00:00Z"
  }
]
```

`task_type` values: `mandatory` | `habit` | `project` | `bonus` | `anchor` | `routine`
`time_block` values: `morning` | `noon` | `evening` | `night` | `midnight` | `null`
`status` values: `pending` | `active` | `completed` | `cancelled`

---

### `POST /tasks`
Create a task directly — no LLM in the path. Use for the Add Task form.

**Request body:**
```json
{
  "title": "Read 30 minutes",
  "task_type": "habit",
  "priority": "P2",
  "difficulty": "low",
  "time_block": "evening"
}
```

**Required:** `title`, `task_type`
**Optional:** `priority`, `difficulty`, `time_block`, `scheduled_at` (ISO timestamp), `arc_id`, `is_recovery`, `description`

**Response:** The created task object (same shape as GET /tasks items).

**Note:** Description is auto-generated asynchronously after creation — it won't
be in the immediate response but will appear on the next task fetch.

---

### `POST /complete/:taskId`
Mark a task complete. Handles all reward calculations, energy drain, streak,
and level-up detection server-side.

**Response:**
```json
{
  "task_id": 42,
  "xp_gained": 12.5,
  "gold_gained": 6,
  "leveled_up": false,
  "new_level": 4,
  "energy_after": 69
}
```

---

### `POST /cancel/:taskId`
Cancel (soft-delete) a task. Sets `status = 'cancelled'`.

**Response:**
```json
{ "id": 42, "cancelled": true }
```

---

### `GET /shop`
Returns active shop items with today's purchase counts.

**Response:**
```json
[
  {
    "id": 1,
    "name": "YouTube Evening",
    "description": "1 hour of guilt-free YouTube.",
    "cost_gold": 10,
    "type": "leisure",
    "purchased_today": 0
  }
]
```

`type` values: `leisure` | `day_off`

---

### `POST /buy/:itemId`
Purchase a shop item. Deducts from `available_gold` only.

**Response:**
```json
{
  "item_id": 1,
  "item_name": "YouTube Evening",
  "gold_spent": 10,
  "gold_remaining": 72
}
```

**Errors:** `400` if insufficient gold or item inactive.

---

### `GET /skills`
Returns all skills ordered by level descending.

**Response:**
```json
[
  {
    "id": 3,
    "name": "Deep Work",
    "description": "Auto-generated from tasks: write report, finish proposal, code review.",
    "category": "dynamic",
    "is_dynamic": true,
    "current_level": 2,
    "current_xp": 45,
    "xp_to_next": 109,
    "current_streak": 3
  }
]
```

---

### `GET /stats`
Returns all 8 base stats.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Strength",
    "description": "Physical power and endurance",
    "icon": null,
    "current_value": 23.4,
    "current_streak": 2
  }
]
```

---

### `GET /snapshots`
Returns last 30 days of daily snapshots for graphs.

**Response:**
```json
[
  {
    "date": "2026-05-08",
    "level": 3,
    "current_xp": 210,
    "total_gold": 95,
    "available_gold": 60,
    "day_streak": 4,
    "energy": 80,
    "mandatory_met": true,
    "tasks_completed": 5,
    "tasks_carried": 0
  }
]
```

---

### `GET /calendar`
Returns per-day task summary for a month.

**Query params:**
- `month` — `YYYY-MM` (optional, defaults to current month)

**Response:**
```json
{
  "2026-06-01": { "total": 4, "completed": 3, "carried": 1, "missed": 0 },
  "2026-06-02": { "total": 3, "completed": 3, "carried": 0, "missed": 0 }
}
```

---

### `POST /chat`
Send a message to the LLM agent. Handles task management, queries, and free-form conversation.

**Request body:**
```json
{
  "session_id": "web",
  "message": "Complete the morning run"
}
```

**Response:**
```json
{ "reply": "Morning run — done. +12 XP, 6g. Energy: 69/100." }
```

**Note:** After any chat response, refresh tasks and state — the agent may have
mutated database state.

---

## Display Reward Computation

Read reward values from `window.LIFEMAP_CONFIG.mechanics` (populated at boot
via `GET /config`). Never hardcode:

```js
function computeDisplayRewards(task) {
  const m = window.LIFEMAP_CONFIG?.mechanics
  if (!m) return { xp: 0, gold: 0 }

  if (task.task_type === 'routine') {
    return { xp: m.xp_base.routine, gold: m.gold_base_routine }
  }

  const xp   = m.xp_base[task.task_type] ?? 0
  const gold = Math.max(
    m.gold_floor,
    (m.gold_base[task.priority] ?? 3) + (m.gold_difficulty_offset[task.difficulty] ?? 0)
  )
  return { xp, gold }
}
```

---

## Task Type Reference

| Type | Icon | Meaning |
|---|---|---|
| `mandatory` | ⚔ | Must complete today or streak breaks |
| `habit` | 🔄 | Recurring behaviour being built |
| `project` | 📋 | Multi-session work item |
| `bonus` | ⭐ | Optional upside, expires if missed |
| `anchor` | ⚓ | Fixed daily anchor point |
| `routine` | 🌿 | Flat 4 XP / 2g, resets nightly |

---

## Energy Threshold Labels

| Label | Meaning | UI colour |
|---|---|---|
| `normal` | >60% energy | Blue (`--energy-normal`) |
| `reduced` | 30–60% | Orange (`--energy-reduced`) |
| `min_viable` | 10–30% | Red (`--energy-min`) |
| `recovery` | <10% | Dark red, pulsing (`--energy-recovery`) |

---

## Error Format

All errors return `4xx` or `5xx` with:
```json
{ "error": "Human-readable error message" }
```
