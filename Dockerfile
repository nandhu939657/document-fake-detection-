FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the CPU-only ML runtime first so it's cached across rebuilds that
# only touch application code (this layer is large and slow to redownload).
COPY scripts/requirements.txt scripts/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    -r scripts/requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu

# Install Ollama and bake the explanation model into the image at build time
# (so a fresh container doesn't need to download ~2GB on first request).
RUN curl -fsSL https://ollama.com/install.sh | sh
ENV OLLAMA_MODEL=llama3.2:3b
RUN (ollama serve &) && sleep 5 && ollama pull ${OLLAMA_MODEL}

COPY . .
RUN npm install -g corepack@latest && corepack pnpm install && corepack pnpm run build

ENV NODE_ENV=production
CMD ["sh", "-c", "ollama serve & exec node dist/index.js"]
