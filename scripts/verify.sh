#!/bin/sh
# 一次性核验：单元测试 -> 构建检查 -> HTTP 冒烟；任一步失败即以非零码退出。
set -eu

echo "== [1/3] 代码测试 (vitest) =="
npm test

echo "== [2/3] 构建检查 (tsc --noEmit && vite build) =="
npm run build

echo "== [3/3] HTTP 冒烟 (http://web) =="
# 健康检查端点
wget -q -O - "http://web/healthz" | grep -qx "ok"
# 首页可访问且包含挂载点
wget -q -O - "http://web/" | grep -q '<div id="root"></div>'
# 静态资源可下载
asset=$(wget -q -O - "http://web/" | sed -n 's/.*src="\(\/assets\/[^"]*\.js\)".*/\1/p' | head -1)
test -n "$asset"
wget -q -O /dev/null "http://web$asset"

echo "== verify 全部通过 =="
