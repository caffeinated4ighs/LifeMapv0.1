CREATE TABLE daily_snapshot (
  id           serial PRIMARY KEY,
  date         date NOT NULL UNIQUE,
  level        int,
  current_xp   int,
  total_gold   int,
  available_gold int,
  day_streak   int,
  energy       int,
  mandatory_met bool,
  tasks_completed int,
  tasks_carried   int,
  created_at   timestamp NOT NULL DEFAULT now()
);