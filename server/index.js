import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const distDir = path.resolve(__dirname, "../dist");
const logConfig = {
  dir: process.env.LOG_DIR || path.join(appDir, "logs"),
  timezone: process.env.TZ || "Asia/Shanghai",
  console: process.env.LOG_TO_CONSOLE !== "false"
};

app.use(express.json({ limit: "24mb" }));

function logDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: logConfig.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function logLine(level, message, fields = {}) {
  const parts = logDateParts();
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const timestamp = `${date} ${parts.hour}:${parts.minute}:${parts.second}`;
  const context = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  const line = `[${timestamp}] [${level}] ${message}${context ? ` ${context}` : ""}`;

  fs.mkdirSync(logConfig.dir, { recursive: true });
  fs.appendFileSync(path.join(logConfig.dir, `${date}.log`), `${line}\n`);

  if (logConfig.console) {
    console.log(line);
  }
}

function requestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function durationMs(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchUpstream(route, endpoint, model, options) {
  const id = requestId();
  const startedAt = performance.now();

  logLine("INFO", "upstream request started", { id, route, model, endpoint });

  try {
    const upstreamResponse = await fetch(endpoint, options);
    logLine("INFO", "upstream request finished", {
      id,
      route,
      model,
      status: upstreamResponse.status,
      duration_ms: durationMs(startedAt)
    });
    return upstreamResponse;
  } catch (error) {
    logLine("ERROR", "upstream request failed", {
      id,
      route,
      model,
      duration_ms: durationMs(startedAt),
      error: safeError(error)
    });
    throw error;
  }
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) {
    throw new Error("请填写中转站链接");
  }

  return trimmed.replace(/\/+$/, "");
}

function imageEndpoint(baseUrl) {
  if (baseUrl.endsWith("/images/generations")) {
    return baseUrl;
  }

  if (baseUrl.endsWith("/v1")) {
    return `${baseUrl}/images/generations`;
  }

  return `${baseUrl}/v1/images/generations`;
}

function chatEndpoint(baseUrl) {
  if (baseUrl.endsWith("/chat/completions")) {
    return baseUrl;
  }

  if (baseUrl.endsWith("/v1")) {
    return `${baseUrl}/chat/completions`;
  }

  return `${baseUrl}/v1/chat/completions`;
}

function pickImagePayload(body) {
  const allowed = [
    "model",
    "prompt",
    "background",
    "moderation",
    "n",
    "output_compression",
    "output_format",
    "quality",
    "response_format",
    "size",
    "style",
    "user"
  ];

  return Object.fromEntries(
    allowed
      .filter((key) => body[key] !== undefined && body[key] !== "")
      .map((key) => [key, body[key]])
  );
}

app.post("/api/generate-image", async (request, response) => {
  try {
    const { baseUrl, apiKey, ...body } = request.body || {};
    const endpoint = imageEndpoint(normalizeBaseUrl(baseUrl));
    const payload = pickImagePayload(body);

    if (!apiKey || !String(apiKey).trim()) {
      return response.status(400).json({ error: "请填写 API Key" });
    }

    const upstreamResponse = await fetchUpstream("generate-image", endpoint, payload.model, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const responsePayload = contentType.includes("application/json")
      ? await upstreamResponse.json()
      : { raw: await upstreamResponse.text() };

    if (!upstreamResponse.ok) {
      return response.status(upstreamResponse.status).json({
        error: responsePayload?.error?.message || responsePayload?.message || "中转站返回错误",
        details: responsePayload
      });
    }

    return response.json(responsePayload);
  } catch (error) {
    logLine("ERROR", "proxy request failed", { route: "generate-image", error: safeError(error) });
    return response.status(500).json({
      error: error instanceof Error ? error.message : "本地代理请求失败"
    });
  }
});

app.post("/api/optimize-prompt", async (request, response) => {
  try {
    const { baseUrl, apiKey, textModel, style, idea } = request.body || {};
    const endpoint = chatEndpoint(normalizeBaseUrl(baseUrl));
    const model = textModel || "gpt-5.5";

    if (!apiKey || !String(apiKey).trim()) {
      return response.status(400).json({ error: "请填写 API Key" });
    }

    const upstreamResponse = await fetchUpstream("optimize-prompt", endpoint, model, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: "You are an expert image prompt engineer. Return only one polished English image generation prompt. Do not add explanations, markdown, or quotes."
          },
          {
            role: "user",
            content: [
              "Create a high-conversion image prompt for an AI image model.",
              `Desired style: ${style || "refined commercial visual"}`,
              `User goal: ${idea || "a strong visual concept"}`,
              "Include subject, composition, lighting, material detail, mood, camera/rendering language, and a short negative prompt."
            ].join("\n")
          }
        ]
      })
    });

    const payload = await upstreamResponse.json();

    if (!upstreamResponse.ok) {
      return response.status(upstreamResponse.status).json({
        error: payload?.error?.message || payload?.message || "提示词优化接口返回错误",
        details: payload
      });
    }

    return response.json({
      prompt: payload?.choices?.[0]?.message?.content?.trim() || "",
      raw: payload
    });
  } catch (error) {
    logLine("ERROR", "proxy request failed", { route: "optimize-prompt", error: safeError(error) });
    return response.status(500).json({
      error: error instanceof Error ? error.message : "提示词优化请求失败"
    });
  }
});

app.post("/api/reverse-prompt", async (request, response) => {
  try {
    const { baseUrl, apiKey, visionModel, imageDataUrl, instruction } = request.body || {};
    const endpoint = chatEndpoint(normalizeBaseUrl(baseUrl));
    const model = visionModel || "gpt-5.5";

    if (!apiKey || !String(apiKey).trim()) {
      return response.status(400).json({ error: "请填写 API Key" });
    }

    if (!imageDataUrl || !String(imageDataUrl).startsWith("data:image/")) {
      return response.status(400).json({ error: "请上传图片" });
    }

    const upstreamResponse = await fetchUpstream("reverse-prompt", endpoint, model, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You are an expert image prompt engineer. Analyze the image and return one polished English image generation prompt. Do not add explanations, markdown, or quotes."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Reverse engineer this image into a reusable prompt for an AI image model.",
                  instruction ? `User instruction: ${instruction}` : "",
                  "Include subject, composition, lighting, camera or rendering style, colors, materials, mood, important details, and a short negative prompt."
                ].filter(Boolean).join("\n")
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl }
              }
            ]
          }
        ]
      })
    });

    const payload = await upstreamResponse.json();

    if (!upstreamResponse.ok) {
      return response.status(upstreamResponse.status).json({
        error: payload?.error?.message || payload?.message || "图片反推接口返回错误",
        details: payload
      });
    }

    return response.json({
      prompt: payload?.choices?.[0]?.message?.content?.trim() || "",
      raw: payload
    });
  } catch (error) {
    logLine("ERROR", "proxy request failed", { route: "reverse-prompt", error: safeError(error) });
    return response.status(500).json({
      error: error instanceof Error ? error.message : "图片反推请求失败"
    });
  }
});

app.use(express.static(distDir));
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, host, () => {
  logLine("INFO", "Prompt Image Studio listening", { host, port, log_dir: logConfig.dir });
});
