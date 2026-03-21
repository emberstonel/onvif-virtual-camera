FROM node:20-slim

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy application code
COPY main.js ./
COPY src ./src
COPY resources ./resources

# Config is mounted at runtime as /config.yaml
CMD ["node", "main.js"]
