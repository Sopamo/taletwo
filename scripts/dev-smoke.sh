#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root (this script resides in scripts/)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

# Wait for backend /health
printf "Waiting for backend to become healthy"
for i in {1..60}; do
  if curl -sSf http://localhost:3000/health >/dev/null 2>&1; then
    echo
    break
  fi
  printf "."
  sleep 1
  if [[ $i -eq 60 ]]; then
    echo "\nBackend failed to become ready in time. Showing recent logs:"
    docker compose logs --no-color --tail 200 backend || true
    exit 1
  fi
done

# Basic health and hello
echo "Health:" && curl -s http://localhost:3000/health || true
echo "Hello:" && curl -s http://localhost:3000/api/hello || true

# Create a new book and capture ID
BOOK_JSON=$(curl -s -X POST http://localhost:3000/api/books)
BOOK_ID=$(echo "$BOOK_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))')

if [[ -z "$BOOK_ID" ]]; then
  echo "Failed to create book. Response: $BOOK_JSON"
  exit 1
fi

echo "Created book id: $BOOK_ID"

# Update one config field (genre)
echo "Update config (genre):"
curl -s -X POST "http://localhost:3000/api/books/$BOOK_ID/config" \
  -H 'Content-Type: application/json' \
  -d '{"setting":"genre","value":"fantasy"}' || true

echo

# Fetch book back
echo "Fetch book:"
curl -s "http://localhost:3000/api/books/$BOOK_ID" || true

echo

echo "Suggestions (mainCharacter):"
curl -s "http://localhost:3000/api/books/$BOOK_ID/config?s=mainCharacter" || true
echo

echo "Done."
