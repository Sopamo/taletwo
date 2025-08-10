# TaleTwo Backend (Bun + TypeScript)

## Dev

1. Copy env example and set your OpenAI key

```bash
cp ../.env.example ../.env
# edit ../.env and set OPENAI_API_KEY
```

2. Start services

```bash
docker compose up -d --build
```

3. Test endpoints

```bash
# Create a new book
curl -s -X POST http://localhost:3000/api/books | jq
# => { "id": "<bookId>" }

# Get suggestions for a field
BOOK_ID=<bookId>
curl -s "http://localhost:3000/api/books/$BOOK_ID/config?s=mainCharacter" | jq

# Persist a config value
curl -s -X POST http://localhost:3000/api/books/$BOOK_ID/config \
  -H 'Content-Type: application/json' \
  -d '{"setting":"mainCharacter","value":"Avery, a curious engineer"}' | jq

# Fetch book document
curl -s http://localhost:3000/api/books/$BOOK_ID | jq
```

## Production image

```bash
docker build -t taletwo-backend:prod .
docker run --rm -p 3000:3000 taletwo-backend:prod
```
