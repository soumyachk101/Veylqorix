#!/usr/bin/env bash
set -e

REPO_DIR="/Users/soumyachakraborty/Documents/Veylqorix"
cd "$REPO_DIR"

# Ensure on main and up to date
git checkout main >/dev/null 2>&1 || true
git pull origin main >/dev/null 2>&1 || true

# Check if there are changes or untracked files
if [ -z "$(git status --porcelain)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] No changes detected."
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Changes detected! Preparing PR..."

TIMESTAMP=$(date '+%Y%m%d%H%M%S')
BRANCH_NAME="auto-sync-${TIMESTAMP}"

git checkout -b "$BRANCH_NAME"
git add .

# Summarize files changed for commit message
SUMMARY_FILES=$(git diff --cached --name-only | tr '\n' ', ' | sed 's/,$//')
TOTAL_FILES=$(git diff --cached --name-only | wc -l | tr -d ' ')

COMMIT_TITLE="chore(sync): update repository changes [${TOTAL_FILES} files]"
COMMIT_BODY="Automated synchronization for updated files:
${SUMMARY_FILES}

Auto-generated at $(date '+%Y-%m-%d %H:%M:%S')."

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
