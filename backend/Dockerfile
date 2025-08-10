# Production Dockerfile for TaleTwo backend (Bun + TS)
FROM oven/bun:1 AS runner
WORKDIR /app

# Copy project files
COPY package.json tsconfig.json ./
COPY src ./src

# Install dependencies if any (safe even if none)
RUN bun install --no-save

EXPOSE 3000
ENV NODE_ENV=production
CMD ["bun", "run", "start"]
