# -------------------------
# Stage 1: Base runtime
# -------------------------
FROM node:20-alpine AS base

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Copy helper script + extraction wrapper into the image
COPY resources/macvlan-init.sh /usr/local/bin/macvlan-init.sh
COPY resources/copy-helper-script.sh /copy-helper-script.sh

RUN chmod +x /copy-helper-script.sh

# -------------------------
# Stage 2: Development image
# -------------------------
FROM base AS dev

# Install useful tools
RUN apk add --no-cache \
    bash \
    curl \
    iproute2 \
    busybox-extras \
    bind-tools \
    net-tools

CMD ["node", "main.js"]

# -------------------------
# Stage 3: Production image
# -------------------------
FROM base AS prod

CMD ["node", "main.js"]
