#!/usr/bin/env bash
set -e

REPO_DIR="/Users/soumyachakraborty/Documents/Veylqorix"
cd "$REPO_DIR"

# Ensure on main and up to date
git checkout main >/dev/null 2>&1 || true
git pull origin main >/dev/null 2>&1 || true

# Check if there are changes or untracked files (ignoring auto-generated logs/scripts)
if [ -z "$(git status --porcelain)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] No changes detected."
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Changes detected! Generating meaningful PR message..."

TIMESTAMP=$(date '+%Y%m%d%H%M%S')
BRANCH_NAME="sync/${TIMESTAMP}"

# Generate dynamic conventional commit message & PR body
MSG_OUTPUT=$(python3 generate_commit_msg.py)
COMMIT_TITLE=$(echo "$MSG_OUTPUT" | head -n 1)
COMMIT_BODY=$(echo "$MSG_OUTPUT" | tail -n +3)

git checkout -b "$BRANCH_NAME"
git add .
git commit -m "$COMMIT_TITLE" -m "$COMMIT_BODY"

echo "Pushing branch $BRANCH_NAME to origin..."
git push -u origin "$BRANCH_NAME"

echo "Creating Pull Request..."
PR_URL=$(gh pr create --title "$COMMIT_TITLE" --body "$COMMIT_BODY" --base main --head "$BRANCH_NAME")
echo "Created PR: $PR_URL"

echo "Merging Pull Request..."
gh pr merge "$BRANCH_NAME" --merge --auto --delete-branch || gh pr merge "$BRANCH_NAME" --merge --delete-branch

git checkout main
git pull origin main

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Successfully merged PR and synced main."
