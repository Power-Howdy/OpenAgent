#!/bin/sh
for file in AGENTS.md OpenAgent.md; do
  if [ -f "$file" ]; then
    grep -E -i 'npm test|pnpm test|yarn test|pytest|cargo test|npm run lint' "$file" | head -1
    break
  fi
done
