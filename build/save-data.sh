#!/usr/bin/env bash
# Saves whatever is in data/ to the repository. If something else saved in the
# meantime, our newer data wins (this workflow is the only thing that writes data/).
set -u
MSG="${1:-Update card data and scan data}"
BRANCH="${GITHUB_REF_NAME:-main}"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data
if git diff --cached --quiet; then echo "No changes"; exit 0; fi
git commit -q -m "$MSG"
for i in 1 2 3 4 5; do
  if git pull -q --rebase -X theirs origin "$BRANCH" && git push -q origin "HEAD:$BRANCH"; then
    echo "Saved ($MSG)"; exit 0
  fi
  git rebase --abort 2>/dev/null || true
  sleep $((i * 5))
done
echo "Could not save"; exit 1
