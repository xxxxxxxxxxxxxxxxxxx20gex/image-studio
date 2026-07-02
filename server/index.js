import express from "express";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(express.json({ limit: "2mb" }));

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

    if (!apiKey || !String(apiKey).trim()) {
      return response.status(400).json({ error: "请填写 API Key" });
    }

    const upstreamResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(pickImagePayload(body))
    });

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await upstreamResponse.json()
      : { raw: await upstreamResponse.text() };

    if (!upstreamResponse.ok) {
      return response.status(upstreamResponse.status).json({
        error: payload?.error?.message || payload?.message || "中转站返回错误",
        details: payload
      });
    }

    return response.json(payload);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "本地代理请求失败"
    });
  }
});

app.post("/api/optimize-prompt", async (request, response) => {
  try {
    const { baseUrl, apiKey, textModel, style, idea } = request.body || {};
    const endpoint = chatEndpoint(normalizeBaseUrl(baseUrl));

    if (!apiKey || !String(apiKey).trim()) {
      return response.status(400).json({ error: "请填写 API Key" });
    }

    const upstreamResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: textModel || "gpt-5.4",
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
    return response.status(500).json({
      error: error instanceof Error ? error.message : "提示词优化请求失败"
    });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Prompt Image Studio API listening on http://127.0.0.1:${port}`);
});
