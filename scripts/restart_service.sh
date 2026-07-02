#!/usr/bin/env bash
set -euo pipefail

# 可自定义启动参数。这里只放端口、监听地址、日志、PID 等运行状态配置。
APP_DIR="/home/lll/agents/image-studio"
PORT="8897"
HOST="0.0.0.0"
NODE_BIN="node"
LOG_DIR="${APP_DIR}/logs"
RUN_DIR="${APP_DIR}/run"
LOG_FILE="${LOG_DIR}/server.log"
PID_FILE="${RUN_DIR}/image-studio.pid"
START_TIMEOUT="10"
HEALTH_URL="http://127.0.0.1:${PORT}/"

usage() {
  cat <<'EOF'
Image Studio 启动脚本。

用法：
  ./scripts/restart_service.sh --start
  ./scripts/restart_service.sh --restart
  ./scripts/restart_service.sh --help

说明：
  --start    仅在服务未运行时启动。若 PID 文件中的进程仍在运行，会直接退出。
  --restart 先停止 PID 文件记录的旧进程，再启动新进程。
  --help    显示本说明。

可自定义参数：
  打开 scripts/restart_service.sh，修改文件顶部的 APP_DIR、PORT、HOST、
  LOG_DIR、RUN_DIR、LOG_FILE、PID_FILE、START_TIMEOUT、HEALTH_URL。
  这些参数只控制服务启动状态，不包含模型名、API Key 或业务参数。

注意：
  脚本不负责构建前端。修改前端后请先执行 npm run build，再执行 --restart。
EOF
}

ensure_layout() {
  mkdir -p "$LOG_DIR" "$RUN_DIR"
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

current_pid() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if pid_is_running "$pid"; then
      echo "$pid"
      return 0
    fi
  fi

  return 0
}

wait_for_stop() {
  local pid="$1"
  for _ in $(seq 1 20); do
    if ! pid_is_running "$pid"; then
      return 0
    fi
    sleep 0.2
  done

  echo "旧进程未及时退出，发送 SIGKILL：pid=${pid}" >&2
  kill -9 "$pid" 2>/dev/null || true
}

stop_existing() {
  local pid
  pid="$(current_pid)"
  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    return 0
  fi

  echo "停止 Image Studio：pid=${pid}"
  kill "$pid"
  wait_for_stop "$pid"
  rm -f "$PID_FILE"
}

start_service() {
  ensure_layout

  local pid
  pid="$(current_pid)"
  if [[ -n "$pid" ]]; then
    echo "Image Studio 已在运行：pid=${pid}"
    exit 1
  fi

  if [[ ! -f "${APP_DIR}/dist/index.html" ]]; then
    echo "未找到 ${APP_DIR}/dist/index.html。请先执行 npm run build。" >&2
    exit 1
  fi

  : > "$LOG_FILE"
  (
    setsid bash -c "cd '$APP_DIR' && exec env PORT='$PORT' HOST='$HOST' '$NODE_BIN' server/index.js >> '$LOG_FILE' 2>&1" < /dev/null &
    echo $! > "$PID_FILE"
  )

  echo "启动 Image Studio：pid=$(cat "$PID_FILE") port=${PORT} host=${HOST}"
  echo "日志：${LOG_FILE}"

  for _ in $(seq 1 "$START_TIMEOUT"); do
    if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "启动完成：${HEALTH_URL}"
      return 0
    fi
    sleep 1
  done

  echo "启动后健康检查失败，请查看日志：${LOG_FILE}" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  exit 1
}

case "${1:-}" in
  --start)
    start_service
    ;;
  --restart)
    ensure_layout
    stop_existing
    start_service
    ;;
  --help|-h)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
