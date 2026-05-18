# Dockerfile for Glama (https://glama.ai/mcp/servers/SelfPy/science-ai-mcp-server)
# automated safety + quality checks. Not used for end-user installs —
# end users get the npm package via `npx -y science-ai-mcp-server`.
#
# Glama runs this container, sets SCIENCE_AI_API_KEY in the env, and
# expects the MCP server to start on stdio and respond to the standard
# `initialize` / `tools/list` JSON-RPC frames.

FROM node:20-alpine AS build

WORKDIR /app

# Copy manifests first so the layer cache survives source-only edits.
COPY package.json tsconfig.json ./
RUN npm install --omit=optional --no-audit --no-fund

COPY src ./src
RUN npm run build

# --- runtime image: smaller, no dev tooling, no source maps ---
FROM node:20-alpine

WORKDIR /app

# Re-install only production deps for the runtime layer.
COPY package.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY README.md LICENSE server.json ./

# Glama's introspection harness passes SCIENCE_AI_API_KEY at runtime.
ENV NODE_ENV=production

# MCP stdio transport — Glama wires stdin/stdout to its harness.
ENTRYPOINT ["node", "dist/index.js"]
