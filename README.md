# Prompt Image Studio

本地可视化提示词优化与 GPT 图片生成工作台。页面支持保存中转站链接、API Key、模型名和图片参数，然后通过本机 Node 代理调用兼容 OpenAI Images API 的中转站。

## 启动

生产部署启动或重启：

```bash
npm run build
./scripts/restart_service.sh --restart
```

仅在服务未运行时启动：

```bash
./scripts/restart_service.sh --start
```

脚本参数放在 `scripts/restart_service.sh` 文件顶部，可修改 `APP_DIR`、`PORT`、`HOST`、`LOG_DIR`、`RUN_DIR`、`LOG_FILE`、`PID_FILE`、`START_TIMEOUT`、`HEALTH_URL`。这些参数只控制端口、监听地址、日志、PID、启动等待等运行状态，不包含模型名、API Key 或业务参数。

脚本不负责构建前端。修改页面后，请先执行 `npm run build`，再执行 `./scripts/restart_service.sh --restart`。

本地开发启动：

```bash
npm install
npm run dev
```

默认前端地址：

```text
http://127.0.0.1:5173/
```

如果端口被占用，Vite 会自动切到下一个端口，例如 `http://127.0.0.1:5174/`。本地代理默认运行在：

```text
http://127.0.0.1:8787
```

## 中转站链接

页面里的“中转站链接”支持以下写法：

```text
https://example.com
https://example.com/v1
https://example.com/v1/images/generations
```

本地代理会统一转成图片生成接口 `POST /v1/images/generations`。

## 已支持参数

- `model`：默认 `gpt-image-2`，可自定义。
- `prompt`：页面里最终发送的提示词。
- `size`：`1024x1024`、`1024x1536`、`1536x1024`、`auto`。
- `quality`：`auto`、`high`、`medium`、`low`。
- `background`：`auto`、`transparent`、`opaque`。
- `output_format`：`png`、`jpeg`、`webp`。
- `output_compression`：仅在非 PNG 时发送。
- `moderation`：`auto`、`low`。
- `n`：生成张数。
- `response_format`：固定为 `b64_json`，方便本地直接显示图片。

## 配置保存

连接配置和参数保存到当前浏览器的 `localStorage`，不会写入项目文件。API Key 只会从浏览器发送到本机代理，再由本机代理转发给你填写的中转站。
