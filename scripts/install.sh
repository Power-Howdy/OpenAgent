#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run build

dest="${OPENAGENT_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$dest"
ln -sfn "$root/bin/openagent.js" "$dest/openagent"
chmod +x "$root/bin/openagent.js" "$dest/openagent"

echo "Installed $dest/openagent"
case ":$PATH:" in
  *":$dest:"*) ;;
  *) echo "Add $dest to PATH to run \`openagent\` from any directory." ;;
esac
