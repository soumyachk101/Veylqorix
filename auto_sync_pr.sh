#!/usr/bin/env bash
set -u

REPO_DIR="/Users/soumyachakraborty/Documents/Veylqorix"
cd "$REPO_DIR"

# Ensure we're on main before checking
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
if [ "$CURRENT_BRANCH" != "main" ]; then
    git add -A
    git commit -m "chore: save working progress" 2>/dev/null || true
    git checkout main 2>/dev/null || git checkout -f main 2>/dev/null || true
fi

git fetch origin main >/dev/null 2>&1 || true
git reset --hard origin/main >/dev/null 2>&1 || true

# Check if there are changes or untracked files
if [ -z "$(git status --porcelain)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] No changes detected."
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Changes detected! Generating meaningful PR..."

TIMESTAMP=$(date '+%Y%m%d%H%M%S')
BRANCH_NAME="sync/${TIMESTAMP}"

# Stage all files first to inspect
git checkout -b "$BRANCH_NAME"
git add -A

# Generate dynamic conventional commit message & PR body
MSG_OUTPUT=$(python3 generate_commit_msg.py)
COMMIT_TITLE=$(echo "$MSG_OUTPUT" | head -n 1)
COMMIT_BODY=$(echo "$MSG_OUTPUT" | tail -n +3)

git commit -m "$COMMIT_TITLE" -m "$COMMIT_BODY"

echo "Pushing branch $BRANCH_NAME to origin..."
git push -u origin "$BRANCH_NAME"

echo "Creating Pull Request..."
PR_URL=$(gh pr create --title "$COMMIT_TITLE" --body "$COMMIT_BODY" --base main --head "$BRANCH_NAME" 2>&1)
echo "Created PR: $PR_URL"

echo "Merging Pull Request directly..."
# Direct merge via gh pr merge
gh pr merge "$BRANCH_NAME" --merge --delete-branch --admin 2>/dev/null || gh pr merge "$BRANCH_NAME" --merge --delete-branch 2>/dev/null || gh pr merge "$BRANCH_NAME" --squash --delete-branch 2>/dev/null || true

# Switch back to clean main
git checkout -f main
git reset --hard origin/main
git pull origin main

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Successfully merged PR and synced main."
