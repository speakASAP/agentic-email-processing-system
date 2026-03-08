# Agentic Email Processing System — production image
# Uses Node 20; env from .env at runtime (env_file in docker-compose).

FROM node:20-alpine

WORKDIR /app

# Suppress npm update notice (fixes deploy warnings)
ENV npm_config_update_notifier=false

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application and test dataset (docs/sample_intent_dataset.json)
COPY server.js ./
COPY lib ./lib
COPY utils ./utils
COPY public ./public
COPY docs ./docs
COPY nginx ./nginx
COPY scripts ./scripts

# Port 3374 (blue) / 3375 (green) set via env in docker-compose
EXPOSE 3374

ENV NODE_ENV=production

CMD ["node", "server.js"]
