#!/usr/bin/env bash
set -e

# ==============================================================================
# Supabase Diagnostic & Health Sniffer (sb-sniffer) 1-Click Installer
# ==============================================================================

# ANSI Color Codes
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m' # No Color

echo ""
echo -e "${GREEN}  ███████╗██████╗     ███████╗███╗   ██╗██╗███████╗███████╗███████╗██████╗ ${NC}"
echo -e "${GREEN}  ██╔════╝██╔══██╗    ██╔════╝████╗  ██║██║██╔════╝██╔════╝██╔════╝██╔══██╗${NC}"
echo -e "${CYAN}  ███████╗██████╔╝    ███████╗██╔██╗ ██║██║█████╗  █████╗  █████╗  ██████╔╝${NC}"
echo -e "${CYAN}  ╚════██║██╔══██╗    ╚════██║██║╚██╗██║██║██╔══╝  ██╔══╝  ██╔══╝  ██╔══██╗${NC}"
echo -e "${CYAN}  ███████║██████╔╝    ███████║██║ ╚████║██║██║     ██║     ███████╗██║  ██║${NC}"
echo -e "${DIM}  ╚══════╝╚═════╝     ╚══════╝╚═╝  ╚═══╝╚═╝╚═╝     ╚═╝     ╚══════╝╚═╝  ╚═╝${NC}"
echo ""
echo -e "  ${BOLD}Supabase Sniffer 1-Click Fast Installer${NC} ${DIM}── v1.0.0${NC}"
echo -e "  ${DIM}Setting up global CLI & production-ready diagnostic engine...${NC}"
echo ""

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}❌ Error: Node.js is not installed.${NC} Please install Node.js v18 or higher."
  exit 1
fi

NODE_VERSION=$(node -v | tr -d 'v')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${YELLOW}⚠️ Warning: Node.js version $NODE_VERSION detected.${NC} Recommended version is v18 or higher."
fi

# Directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 2. Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo -e "${CYAN}📦 Installing project dependencies...${NC}"
  npm install --silent
else
  echo -e "${GREEN}✓${NC} Dependencies verified."
fi

# 3. Build packages (Core, CLI, and Web Dashboard)
echo -e "${CYAN}⚙️  Building Core, CLI, and Web Dashboard...${NC}"
npm run build --silent

# 4. Make CLI binary executable
chmod +x "$SCRIPT_DIR/packages/cli/dist/index.js"

# 5. Link globally
echo -e "${CYAN}🔗 Linking 'sb-sniffer' into system PATH...${NC}"

LINKED=0
CLI_DIST="$SCRIPT_DIR/packages/cli/dist/index.js"

# Strategy A: npm link
if cd "$SCRIPT_DIR/packages/cli" && npm link >/dev/null 2>&1; then
  cd "$SCRIPT_DIR"
  LINKED=1
fi

# Strategy B: User local bin fallback (~/.local/bin or /opt/homebrew/bin or /usr/local/bin)
TARGET_DIRS=(
  "$HOME/.local/bin"
  "/opt/homebrew/bin"
  "/usr/local/bin"
  "$HOME/bin"
)

for DIR in "${TARGET_DIRS[@]}"; do
  if [ -d "$DIR" ] && [ -w "$DIR" ]; then
    ln -sf "$CLI_DIST" "$DIR/sb-sniffer" 2>/dev/null && LINKED=1
    break
  fi
done

# Check if ~/.local/bin exists or create it
if [ $LINKED -eq 0 ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$CLI_DIST" "$HOME/.local/bin/sb-sniffer"
  LINKED=1
fi

# Symlink local wrapper in project root for convenience
ln -sf "$CLI_DIST" "$SCRIPT_DIR/sb-sniffer"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  🎉 1-CLICK INSTALLATION COMPLETE!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  You can now run ${BOLD}${CYAN}sb-sniffer${NC} anywhere in your terminal."
echo ""
echo -e "  ${BOLD}QUICK SHORTCUTS:${NC}"
echo -e "    ${BOLD}sb-sniffer${NC}                 Launch interactive Welcome Screen & Launch Palette"
echo -e "    ${BOLD}sb-sniffer web${NC}             Launch Web GUI on port 3001 and open browser"
echo -e "    ${BOLD}sb-sniffer analyze --db${NC}    Run live diagnostic audit against Supabase project"
echo -e "    ${BOLD}sb-sniffer tui${NC}             Open keyboard-driven Vim TUI"
echo ""
echo -e "${DIM}  ─────────────────────────────────────────────────────────────────────────────${NC}"
echo -e "  ${CYAN}Launching sb-sniffer now...${NC}\n"
sleep 1

# Launch the tool directly with the interactive welcome screen
exec "$CLI_DIST"
