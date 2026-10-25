#!/usr/bin/env bash
REPO_DIR="/Users/soumyachakraborty/Documents/Veylqorix"
cd "$REPO_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting automated 1-minute scanner & sync daemon..." >> "$REPO_DIR/auto_sync.log"

while true; do
  # Execute scan and auto-PR sync
  ./auto_sync_pr.sh >> "$REPO_DIR/auto_sync.log" 2>&1 || true
  sleep 60
done
