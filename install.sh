#!/bin/bash
set -e

# ============================================================
#  Extella Toolbar Installer v2.0 — Modular Build
#  Single command: builds the whole suite (library module + toolbar) and deploys.
#  1. Runs `npm run build` from the repo root → toolbar/build/
#  2. Installs toolbar.js (plugin UIs are embedded in toolbar.js)
#  3. Optionally installs HTML to Video Studio
# ============================================================

GREEN='\033[0;32m'
AMBER='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "  ██████ Extella Toolbar Installer v2.0"
echo "──────────────────────────────────────────"
echo ""

USER_HOME="$HOME"
LEGACY_PLUGINS_DIR="$HOME/.extella/plugins"
HV_DIR="$HOME/Downloads/html-video"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # repo root (this script lives at the root)
BUILD_DIR="$SCRIPT_DIR/toolbar/build"

# ── Detect OS and set platform-specific defaults ──────────────────────────
OS=$(uname -s)
if [ "$OS" = "Darwin" ]; then
  TB_DIR="$HOME/Library/Application Support/extella-desktop"
  QUIT_CMD="Cmd+Q, then reopen the app"
elif [ "$OS" = "Linux" ]; then
  # Electron userData on Linux defaults to ~/.config/<appName>
  TB_DIR="$HOME/.config/extella-desktop"
  QUIT_CMD="close the Extella window, then reopen it"
  echo -e "${AMBER}  Detected Linux — using path:${NC}"
  echo    "    toolbar.js → $TB_DIR/toolbar.js"
  echo ""
  # Ensure libsecret is present — required for Electron cookie encryption on
  # Linux. Without it the toolbar falls back to a 30-second retry + manual
  # token prompt. We auto-install it here so the primary auth flow works.
  if ! ldconfig -p 2>/dev/null | grep -q libsecret-1; then
    echo -e "  ${AMBER}→ libsecret not found — installing automatically...${NC}"
    INSTALLED_LIBSECRET=0
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y libsecret-1-0 2>/dev/null && INSTALLED_LIBSECRET=1
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y libsecret 2>/dev/null && INSTALLED_LIBSECRET=1
    elif command -v pacman &>/dev/null; then
      sudo pacman -S --noconfirm libsecret 2>/dev/null && INSTALLED_LIBSECRET=1
    elif command -v zypper &>/dev/null; then
      sudo zypper install -y libsecret-1-0 2>/dev/null && INSTALLED_LIBSECRET=1
    fi
    if [ "$INSTALLED_LIBSECRET" = "1" ]; then
      echo -e "  ${GREEN}✓ libsecret installed${NC}"
    else
      echo -e "  ${AMBER}⚠ Could not install libsecret automatically.${NC}"
      echo    "    Auth will still work via a fallback token prompt after ~30 s."
      echo    "    To fix manually: sudo apt install libsecret-1-0  (or dnf/pacman equivalent)"
    fi
    echo ""
  fi
else
  TB_DIR="$HOME/.config/extella-desktop"
  QUIT_CMD="close and reopen the app"
fi

# ── Step 1: Check Node.js ─────────────────────────────────
echo -e "${AMBER}[1/5] Checking Node.js...${NC}"
USE_PREBUILT=""
if ! command -v node &> /dev/null; then
    echo -e "  ${AMBER}⚠ Node.js not found — using the pre-built toolbar from HANDOFF/ (no build needed).${NC}"
    echo    "    For source builds install Node.js 18+ from https://nodejs.org"
    if [ -f "$SCRIPT_DIR/HANDOFF/toolbar.js" ]; then
        mkdir -p "$BUILD_DIR"
        cp "$SCRIPT_DIR/HANDOFF/toolbar.js" "$BUILD_DIR/toolbar.js"
        USE_PREBUILT=1
        echo -e "  ${GREEN}✓ Pre-built toolbar.js ready${NC}"
    else
        echo -e "  ${RED}✗ HANDOFF/toolbar.js missing from the repo. Install Node.js 18+ and re-run.${NC}"
        exit 1
    fi
else
    NODE_VER=$(node -v)
    NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo -e "  ${RED}✗ Node.js $NODE_VER is too old — the build (vite 6) needs 18+.${NC}"
        echo    "    Either upgrade Node, or delete/rename node to use the pre-built HANDOFF path."
        exit 1
    fi
    echo -e "  ${GREEN}✓ Node.js $NODE_VER found${NC}"

    # ── Step 2: Build the whole suite (library module + toolbar) ─
    echo -e "${AMBER}[2/5] Building from source (npm run build)...${NC}"
    cd "$SCRIPT_DIR"
    if [ ! -d node_modules ]; then
        echo -e "  ${AMBER}→ first run: installing workspace deps (npm install)...${NC}"
        npm install
    fi
    # ETB_FROM_INSTALLER tells build.js to skip its own deploy hints — the
    # installer prints its next steps below.
    ETB_FROM_INSTALLER=1 npm run build   # build:library (→ modules/library/dist) then build:toolbar
    echo -e "  ${GREEN}✓ Build complete${NC}"
fi

# ── Step 3: Install toolbar.js ───────────────────────────
echo -e "${AMBER}[3/5] Installing toolbar.js...${NC}"
mkdir -p "$TB_DIR"
if [ -f "$TB_DIR/toolbar.js" ]; then
    BACKUP="$TB_DIR/toolbar.js.bak.$(date +%Y%m%d_%H%M%S)"
    cp "$TB_DIR/toolbar.js" "$BACKUP"
    echo "  → Backup created: $(basename $BACKUP)"
fi
cp "$BUILD_DIR/toolbar.js" "$TB_DIR/toolbar.js"
echo -e "  ${GREEN}✓ toolbar.js installed${NC}"

# Activity Center is a toolbar panel plus a small local bridge. The panel is
# already compiled into toolbar.js; install its macOS activity observer and
# registry-scoped localhost controls without modifying the generated artifact.
if [ "$OS" = "Darwin" ] && command -v python3 &> /dev/null; then
    python3 "$SCRIPT_DIR/device/activity-center/install.py"
    echo -e "  ${GREEN}✓ Activity Center observer installed${NC}"
fi

if [ -d "$LEGACY_PLUGINS_DIR" ]; then
    rm -rf "$LEGACY_PLUGINS_DIR"
    echo -e "  ${GREEN}✓ Removed legacy $LEGACY_PLUGINS_DIR (UI is embedded in toolbar.js)${NC}"
fi

# ── Step 4: Install HTML to Video Studio ────────────────
echo -e "${AMBER}[4/5] Installing HTML to Video Studio...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "  ${AMBER}⚠ Node.js not found — skipping html-video install${NC}"
elif [ -d "$HV_DIR" ]; then
    echo -e "  ${GREEN}✓ html-video already installed at $HV_DIR${NC}"
else
    if ! command -v pnpm &> /dev/null; then
        echo "  → Installing pnpm..."
        npm install -g pnpm --quiet
    fi
    echo "  → Cloning html-video..."
    git clone https://github.com/nexu-io/html-video.git "$HV_DIR" --quiet
    echo "  → Installing dependencies (~1 min)..."
    cd "$HV_DIR" && pnpm install --silent
    echo -e "  ${GREEN}✓ html-video installed${NC}"
fi

# ── Step 6: API Keys ──────────────────────────────────────
echo -e "${AMBER}[5/5] Configure API keys...${NC}"
echo ""
echo "  HTML to Video needs an Anthropic API key."
echo "  Get yours at: https://console.anthropic.com"
echo ""
read -p "  Enter Anthropic API key (sk-ant-..., or Enter to skip): " ANTHROPIC_KEY
echo ""
read -p "  Enter ElevenLabs API key (for voiceover, Enter to skip): " ELEVENLABS_KEY
echo ""
read -p "  Enter Replicate API key (for music, Enter to skip): " REPLICATE_KEY
echo ""
read -p "  Enter Extella API token (from api.extella.ai, Enter to skip): " EXTELLA_TOKEN_INPUT
echo ""

# Save Anthropic key to html-video .env
if [ -d "$HV_DIR" ] && [ -n "$ANTHROPIC_KEY" ]; then
    cat > "$HV_DIR/.env" << EOF
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
ELEVENLABS_API_KEY=$ELEVENLABS_KEY
REPLICATE_API_KEY=$REPLICATE_KEY
EOF
    echo -e "  ${GREEN}✓ API keys saved to html-video/.env${NC}"
fi

# Save Extella token for toolbar (stored as a JS snippet in userData)
if [ -n "$EXTELLA_TOKEN_INPUT" ]; then
    mkdir -p "$TB_DIR"
    echo "$EXTELLA_TOKEN_INPUT" > "$TB_DIR/api_token.txt"
    echo -e "  ${GREEN}✓ Extella token saved${NC}"
fi

# ── Start html-video if installed ────────────────────────
if [ -d "$HV_DIR" ] && [ -n "$ANTHROPIC_KEY" ]; then
    echo ""
    echo -e "${AMBER}Starting HTML to Video Studio...${NC}"
    # Убиваем ТОЛЬКО свои прежние html-video процессы, не чужие на этих портах
    pgrep -f "html-video" | xargs kill 2>/dev/null || true
    cd "$HV_DIR"
    ANTHROPIC_API_KEY="$ANTHROPIC_KEY" \
    ELEVENLABS_API_KEY="$ELEVENLABS_KEY" \
    PORT=3071 \
    nohup node packages/cli/dist/bin.js studio > /tmp/html-video.log 2>&1 &
    sleep 3
    if lsof -ti :3071 &> /dev/null; then
        echo -e "  ${GREEN}✓ HTML to Video Studio running on localhost:3071${NC}"
    else
        echo -e "  ${RED}✗ Failed to start. Check /tmp/html-video.log${NC}"
    fi
fi

# ── Done ──────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────"
echo -e "  ${GREEN}✅ Installation complete!${NC}"
echo ""
echo "  Installed:"
echo -e "  ${CYAN}→${NC} $TB_DIR/toolbar.js"
echo "     (marketplace, plugin chat, and forms are embedded in toolbar.js)"
if [ "$OS" = "Darwin" ]; then
  echo -e "  ${CYAN}→${NC} Activity Center observer at http://127.0.0.1:8799"
fi
echo ""
  echo "  Next steps:"
  echo "  1. Restart Extella ($QUIT_CMD)"
echo "  2. The new modular toolbar will appear at the top"
echo "  3. MCP Connectors tab: click '+ GitHub Repo' to add a repo"
echo "  4. Library / Marketing tabs: browse installed knowledge packs"
echo "  5. Click 'Plugins' to open the full marketplace"
echo ""
echo "  To rebuild after editing sources:"
echo "  node build.js"
echo ""
echo "  To watch and auto-rebuild on changes:"
echo "  node build.js --watch"
echo ""
