#!/bin/bash
# ============================================================================
# BetSafe — Setup script for a fresh Ubuntu 22.04 VPS
# ============================================================================
# Usage (as root on the VPS):
#   bash <(curl -fsSL https://raw.githubusercontent.com/TheCodingX/BetSafe/main/vps/setup.sh)
#
# Lo que hace, idempotente (se puede correr varias veces sin romper):
#   1. apt update + paquetes base (curl, git, build, ufw)
#   2. Node.js 20 desde NodeSource
#   3. pm2 global (process manager)
#   4. Dependencias de sistema para Playwright/Chromium headless
#   5. Firewall UFW: solo 22 (SSH) + 8787 (backend)
#   6. Clone del repo en /opt/betsafe (o pull si ya existe)
#   7. npm ci en server/ + npx playwright install chromium
#   8. Crea .env template (el user lo completa después con sus API keys)
#
# NO arranca el server al final — eso requiere .env completo. El último
# print del script imprime los comandos exactos para arrancarlo manualmente.
# ============================================================================

set -e

REPO_URL="https://github.com/TheCodingX/BetSafe.git"
APP_DIR="/opt/betsafe"
SERVER_DIR="$APP_DIR/server"
NODE_MAJOR="20"
PM2_APP_NAME="betsafe"
PORT="8787"

echo "=================================================="
echo " BetSafe VPS Setup — Ubuntu 22.04"
echo "=================================================="
echo " Target:  $APP_DIR"
echo " Port:    $PORT"
echo " Repo:    $REPO_URL"
echo ""

# Check we're root
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: este script debe correr como root (usá: sudo bash setup.sh)"
  exit 1
fi

# ── 1/8 apt update + base packages ────────────────────────────────────────
echo ""
echo "[1/8] Actualizando paquetes apt e instalando base..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y --no-install-recommends
apt-get install -y --no-install-recommends \
  curl wget git nano \
  build-essential ca-certificates \
  ufw \
  software-properties-common \
  gnupg lsb-release

# ── 2/8 Node.js 20 ─────────────────────────────────────────────────────────
echo ""
echo "[2/8] Instalando Node.js $NODE_MAJOR..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "  Node:  $(node -v)"
echo "  npm:   $(npm -v)"

# ── 3/8 pm2 ─────────────────────────────────────────────────────────────────
echo ""
echo "[3/8] Instalando pm2 (process manager)..."
npm install -g pm2

# ── 4/8 Playwright system deps for Chromium headless ──────────────────────
echo ""
echo "[4/8] Instalando dependencias de sistema para Playwright/Chromium..."
apt-get install -y --no-install-recommends \
  libnss3 libnspr4 \
  libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 \
  libasound2 \
  fonts-liberation \
  libxshmfence1 \
  xdg-utils

# ── 5/8 UFW firewall ──────────────────────────────────────────────────────
echo ""
echo "[5/8] Configurando firewall local (ufw)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow ${PORT}/tcp comment 'BetSafe backend'
ufw --force enable
echo "  UFW status:"
ufw status verbose | sed 's/^/    /'

# ── 6/8 Clone repo ────────────────────────────────────────────────────────
echo ""
echo "[6/8] Clonando repo en $APP_DIR..."
if [ -d "$APP_DIR/.git" ]; then
  echo "  Repo ya existe — git pull..."
  cd "$APP_DIR"
  git pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

# ── 7/8 npm install + Playwright Chromium ─────────────────────────────────
echo ""
echo "[7/8] Instalando dependencias del server (esto puede tardar 5-10 min)..."
cd "$SERVER_DIR"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo ""
echo "  Instalando Chromium para Playwright (~150MB descarga)..."
npx --yes playwright install chromium

# ── 8/8 .env template ─────────────────────────────────────────────────────
echo ""
echo "[8/8] Preparando archivo .env..."
if [ ! -f "$SERVER_DIR/.env" ]; then
  if [ -f "$APP_DIR/vps/env.example" ]; then
    cp "$APP_DIR/vps/env.example" "$SERVER_DIR/.env"
    echo "  .env creado desde vps/env.example"
  else
    cat > "$SERVER_DIR/.env" <<'ENVEOF'
# BetSafe Backend — completá con valores reales (copiá de Render)
PORT=8787
NODE_ENV=production
ENABLED_BOOKS=bplay,betano,betwarrior,bet365ar,codere,betsson
SCRAPE_INTERVAL_MS=30000

# Data APIs
THE_ODDS_API_KEY=
APISPORTS_KEY=
SCRAPINGBEE_KEY=
RAPIDAPI_KEY=
OPENWEATHER_API_KEY=
BS_FOOTBALL_DATA_API_KEY=

# IA Providers
BS_GEMINI_API_KEY=
BS_GROQ_API_KEY=
BS_OPENROUTER_API_KEY=

# Supabase
BS_SUPABASE_URL=
BS_SUPABASE_ANON_KEY=

# CF Worker proxy
CF_PROXY_URL=https://betsafe-proxy.betwinadmins.workers.dev
CF_PROXY_KEY=adc9e41349bb1c76b973bbe681f172126af9b8f4dcedb7b5f09b6445abe3c1df
ENVEOF
    echo "  .env creado con template default"
  fi
  chmod 600 "$SERVER_DIR/.env"
else
  echo "  .env ya existe en $SERVER_DIR/.env — no lo sobreescribo"
fi

# ── DONE ──────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo " ✓ SETUP TERMINADO"
echo "=================================================="
echo ""
echo " PASO MANUAL: completá las API keys del .env"
echo "   nano $SERVER_DIR/.env"
echo ""
echo "   (Copiá los valores desde Render → Environment)"
echo ""
echo " Después, levantá el server:"
echo "   cd $SERVER_DIR"
echo "   pm2 start server.js --name $PM2_APP_NAME"
echo "   pm2 save"
echo "   pm2 startup     # ejecuta el comando que imprime"
echo ""
echo " Verificá que esté vivo:"
echo "   curl http://localhost:$PORT/api/health"
echo ""
echo " Logs en vivo:"
echo "   pm2 logs $PM2_APP_NAME"
echo ""
