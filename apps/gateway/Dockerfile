FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/gateway/package.json apps/gateway/
RUN npm ci --workspace apps/gateway --include-workspace-root=false || npm install --workspace apps/gateway
COPY apps/gateway apps/gateway
RUN npm run build -w apps/gateway

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/gateway/package.json apps/gateway/
RUN npm ci --workspace apps/gateway --omit=dev --include-workspace-root=false || npm install --workspace apps/gateway --omit=dev
COPY --from=build /app/apps/gateway/dist apps/gateway/dist
EXPOSE 8000
CMD ["node", "apps/gateway/dist/index.js"]
