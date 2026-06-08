#!/bin/bash
# Life Map — Setup Script
# Run from repo root: bash scripts/setup.sh
# Tested on macOS and Linux. Requires: node >=20, npm, npx.

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}=== LIFE MAP SETUP ===${RESET}"
echo ""

# ── 1. Check prerequisites ────────────────────────────────────────────────────
echo "Checking prerequisites..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js required. Install from nodejs.org"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "❌ npm required."; exit 1; }
NODE_VERSION=$(node -e "process.stdout.write(process.version)")
echo -e "${GREEN}✅ Node.js ${NODE_VERSION}${RESET}"

# ── 2. Collect credentials interactively ─────────────────────────────────────
echo ""
echo -e "${BOLD}=== CREDENTIALS ===${RESET}"
echo ""

echo "Enter your Google AI Studio API key (from aistudio.google.com):"
read -rs GOOGLE_API_KEY
echo ""

echo "Enter your Supabase project URL (e.g. https://xxxx.supabase.co):"
read -r SUPABASE_URL
echo ""

echo "Enter your Supabase service role key (Settings → API → service_role):"
read -rs SUPABASE_SERVICE_KEY
echo ""

echo "Enter a CRON_SECRET — any random string. Suggested: $(openssl rand -hex 16 2>/dev/null || cat /dev/urandom | head -c 16 | xxd -p)"
read -rs CRON_SECRET
echo ""

echo "Enter your Discord webhook URL (optional — press Enter to skip):"
read -r DISCORD_WEBHOOK_URL
echo ""

echo "Enter your Discord bot token (optional — press Enter to skip):"
read -rs DISCORD_BOT_TOKEN
echo ""

echo "Enter your Discord channel ID (optional — press Enter to skip):"
read -r DISCORD_CHANNEL_ID
echo ""

# ── 3. Write .env ─────────────────────────────────────────────────────────────
mkdir -p config
cat > config/.env << EOF
GOOGLE_API_KEY=${GOOGLE_API_KEY}
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
CRON_SECRET=${CRON_SECRET}
DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
DISCORD_CHANNEL_ID=${DISCORD_CHANNEL_ID}
NODE_ENV=development
EOF
echo -e "${GREEN}✅ config/.env written${RESET}"

# Also write api/.env (server.js loads from process.env via dotenv)
cp config/.env api/.env
echo -e "${GREEN}✅ api/.env written (copy of config/.env)${RESET}"

# ── 4. Install dependencies ───────────────────────────────────────────────────
echo ""
echo "Installing API dependencies..."
cd api && npm install && cd ..
echo -e "${GREEN}✅ Dependencies installed${RESET}"

# ── 5. Database migrations ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== DATABASE SETUP ===${RESET}"
echo ""
echo -e "${YELLOW}You need to run all migrations in the Supabase SQL editor.${RESET}"
echo "Open: ${SUPABASE_URL}/project/default/sql/new"
echo ""
echo "Run these files in order (copy/paste each into the SQL editor):"
echo ""
ls "Sql Setup/"*.sql 2>/dev/null | sort || echo "  (no migration files found — check Sql Setup/ directory)"
echo ""
echo "Press Enter when all migrations are complete..."
read -r

# ── 6. Seed stat embeddings ───────────────────────────────────────────────────
echo ""
echo "Seeding stat embeddings (calls Google embedding API)..."
cd api && node embed_seed.js && cd ..
echo -e "${GREEN}✅ Stat embeddings seeded${RESET}"

# ── 7. Deploy edge functions ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== SUPABASE EDGE FUNCTIONS ===${RESET}"
echo ""

if command -v npx >/dev/null 2>&1; then
  echo "Logging into Supabase CLI..."
  npx supabase login

  echo "Deploying post-task-completion..."
  npx supabase functions deploy post-task-completion --project-ref "$(echo "$SUPABASE_URL" | sed 's|https://||' | cut -d. -f1)"

  echo "Deploying on-skill-rename..."
  npx supabase functions deploy on-skill-rename --project-ref "$(echo "$SUPABASE_URL" | sed 's|https://||' | cut -d. -f1)"

  echo -e "${GREEN}✅ Edge functions deployed${RESET}"
else
  echo -e "${YELLOW}npx not found — deploy edge functions manually:${RESET}"
  echo "  npx supabase functions deploy post-task-completion"
  echo "  npx supabase functions deploy on-skill-rename"
fi

echo ""
echo -e "${YELLOW}Set these secrets in Supabase dashboard:${RESET}"
echo "  Project Settings → Edge Functions → Secrets"
echo "  SB_SERVICE_KEY = (your Supabase service role key)"
echo "  GOOGLE_API_KEY = (your Google AI Studio key)"
echo ""
echo "Press Enter when secrets are set..."
read -r

# ── 8. GitHub Actions secrets ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== GITHUB ACTIONS ===${RESET}"
echo ""
echo "Add these secrets to your GitHub repo:"
echo "  Repository Settings → Secrets and variables → Actions → New repository secret"
echo ""
echo "  CRON_SECRET   = ${CRON_SECRET}"
echo "  SERVER_URL    = (your Render deployment URL — set after Render deploy below)"
echo ""

# ── 9. Render deployment ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== RENDER DEPLOYMENT ===${RESET}"
echo ""
echo "Option A — Blueprint (recommended):"
echo "  Go to render.com → New → Blueprint → connect repo → render.yaml auto-detects"
echo ""
echo "Option B — Manual:"
echo "  1. render.com → New Web Service → connect your GitHub repo"
echo "  2. Root Directory: api"
echo "  3. Build Command: npm install"
echo "  4. Start Command: node src/server.js"
echo "  5. Add environment variables:"
echo "     GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET"
echo "     DISCORD_WEBHOOK_URL, DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID"
echo "     NODE_ENV=production, TZ=America/New_York"
echo ""
echo "After Render deploys, copy the service URL and add it as SERVER_URL in GitHub Secrets."
echo ""

# ── 10. Verify local server starts ───────────────────────────────────────────
echo -e "${BOLD}=== LOCAL TEST ===${RESET}"
echo ""
echo "Starting server locally for 5 seconds to verify setup..."
cd api && timeout 5 node src/server.js 2>&1 | head -5 || true && cd ..
echo ""
echo -e "${GREEN}✅ Setup complete!${RESET}"
echo ""
echo "To start the server locally:"
echo "  cd api && node src/server.js"
echo ""
echo "Then open http://localhost:3001 in your browser."
echo ""
