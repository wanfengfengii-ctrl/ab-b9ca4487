# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---------- 静态站点（默认目标） ----------
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# ---------- 一次性核验服务 ----------
FROM node:22-alpine AS verify
WORKDIR /app
# 冒烟需要访问 web 容器；busybox wget 已随 alpine 提供
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY scripts/verify.sh /app/verify.sh
RUN chmod +x /app/verify.sh
ENTRYPOINT ["/app/verify.sh"]
