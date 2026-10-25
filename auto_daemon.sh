#!/usr/bin/env bash
REPO_DIR="/Users/soumyachakraborty/Documents/Veylqorix"
cd "$REPO_DIR"

while true; do
  ./auto_sync_pr.sh >/dev/null 2>&1 || true
  sleep 60
done
