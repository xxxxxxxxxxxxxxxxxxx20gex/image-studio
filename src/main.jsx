import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
  Eye,
  ImageIcon,
  KeyRound,
  Loader2,
  Paintbrush,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Wand2
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "prompt-image-studio.config";
const DB_NAME = "prompt-image-studio";
const DB_VERSION = 1;
const IMAGE_STORE = "images";

const defaultConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  textModel: "gpt-5.4",
  visionModel: "gpt-4o",
  imageModel: "gpt-image-2",
  size: "1024x1024",
  quality: "auto",
  background: "auto",
  outputFormat: "png",
  outputCompression: 100,
  moderation: "auto",
  n: 1
};

const stylePresets = [
  "电影级真实摄影，低调高级，丰富细节，柔和自然光",
  "商业海报视觉，清晰主体，干净构图，强产品质感",
  "赛博朋克城市夜景，高对比霓虹，雨夜反光，电影镜头",
  "日系治愈插画，温暖色彩，柔和线条，空气感",
  "高级概念艺术，史诗尺度，层次丰富，细节密集"
];

const sizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];
const qualities = ["auto", "high", "medium", "low"];
const backgrounds = ["auto", "transparent", "opaque"];
const formats = ["png", "jpeg", "webp"];
const moderations = ["auto", "low"];

function loadConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return defaultConfig;
  }
}

function compactPrompt(style, idea) {
  return [
    "Create one high-quality image.",
    `Style: ${style.trim() || "clean, refined, visually coherent"}.`,
    `Subject and intent: ${idea.trim() || "a memorable visual concept"}.`,
    "Composition: clear focal point, professional lighting, strong silhouette, coherent color palette.",
    "Avoid: blurry details, extra text, watermark, distorted anatomy, low-resolution artifacts."
  ].join("\n");
}

function b64ToObjectUrl(base64, mime = "image/png") {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function openImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function readStoredImages() {
  const db = await openImageDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, "readonly");
    const store = transaction.objectStore(IMAGE_STORE);
    const request = store.getAll();

    request.addEventListener("success", () => {
      resolve(
        request.result
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, 8)
      );
    });
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => db.close());
  });
}

async function saveStoredImages(images) {
  const db = await openImageDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE);

    images.forEach((image) => {
      store.put({
        id: image.id,
        dataUrl: image.dataUrl,
        prompt: image.prompt,
        model: image.model,
        revisedPrompt: image.revisedPrompt,
        createdAt: image.createdAt
      });
    });

    const request = store.getAll();
    request.addEventListener("success", () => {
      const stale = request.result
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(8);
      stale.forEach((image) => store.delete(image.id));
    });
    transaction.addEventListener("complete", () => {
      db.close();
      resolve();
    });
    transaction.addEventListener("error", () => {
      db.close();
      reject(transaction.error);
    });
  });
}

function extractImages(payload) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return Promise.all(
    items.map(async (item, index) => {
      if (item.b64_json) {
        const mime = item.output_format ? `image/${item.output_format}` : "image/png";
        return {
          id: `${Date.now()}-${index}`,
          dataUrl: `data:${mime};base64,${item.b64_json}`,
          src: b64ToObjectUrl(item.b64_json, mime),
          revisedPrompt: item.revised_prompt,
          createdAt: Date.now()
        };
      }

      if (item.url) {
        let dataUrl = item.url;

        try {
          const imageResponse = await fetch(item.url);
          const blob = await imageResponse.blob();
          dataUrl = await blobToDataUrl(blob);
        } catch {
          dataUrl = item.url;
        }

        return {
          id: `${Date.now()}-${index}`,
          dataUrl,
          src: dataUrl,
          revisedPrompt: item.revised_prompt,
          createdAt: Date.now()
        };
      }

      return null;
    })
  ).then((images) => images.filter(Boolean));
}

function sanitizeImageResponse(payload) {
  if (!payload || !Array.isArray(payload.data)) {
    return payload;
  }

  return {
    ...payload,
    data: payload.data.map((item) => {
      if (!item?.b64_json) {
        return item;
      }

      return {
        ...item,
        b64_json: `[omitted ${item.b64_json.length.toLocaleString()} base64 chars]`
      };
    })
  };
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function App() {
  const [config, setConfig] = useState(loadConfig);
  const [idea, setIdea] = useState("一张 PromptBase 风格的高转化商品封面，展示一个未来感 AI 提示词市场");
  const [style, setStyle] = useState(stylePresets[1]);
  const [prompt, setPrompt] = useState(() => compactPrompt(stylePresets[1], "一张 PromptBase 风格的高转化商品封面，展示一个未来感 AI 提示词市场"));
  const [images, setImages] = useState([]);
  const [activeImage, setActiveImage] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [rawResponse, setRawResponse] = useState(null);
  const [reverseImage, setReverseImage] = useState(null);
  const [reverseInstruction, setReverseInstruction] = useState("保留主体、构图、光线和质感，生成适合文生图模型复现的英文提示词。");
  const [reversePrompt, setReversePrompt] = useState("");
  const [reverseError, setReverseError] = useState("");
  const [reverseStatus, setReverseStatus] = useState("idle");

  useEffect(() => {
    let cancelled = false;

    readStoredImages()
      .then((storedImages) => {
        if (cancelled) {
          return;
        }

        const nextImages = storedImages.map((image) => ({
          ...image,
          src: image.dataUrl
        }));
        setImages(nextImages);
        setActiveImage(nextImages[0] || null);
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取本地图片历史失败。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const payloadPreview = useMemo(() => ({
    model: config.imageModel,
    prompt,
    size: config.size,
    quality: config.quality,
    background: config.background,
    output_format: config.outputFormat,
    output_compression: config.outputFormat === "png" ? undefined : Number(config.outputCompression),
    moderation: config.moderation,
    n: Number(config.n),
    response_format: "b64_json"
  }), [config, prompt]);

  function updateConfig(key, value) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setStatus("saved");
    window.setTimeout(() => setStatus("idle"), 1200);
  }

  async function handleReverseImage(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setReverseError("请上传图片文件。");
      return;
    }

    const dataUrl = await blobToDataUrl(file);
    setReverseImage({
      name: file.name,
      dataUrl
    });
    setReversePrompt("");
    setReverseError("");
  }

  async function reversePromptFromImage() {
    if (!reverseImage) {
      setReverseError("请先上传图片。");
      return;
    }

    setReverseStatus("reversing");
    setReverseError("");

    try {
      const response = await fetch("/api/reverse-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          visionModel: config.visionModel,
          imageDataUrl: reverseImage.dataUrl,
          instruction: reverseInstruction
        })
      });
      const data = await response.json();

      if (!response.ok || !data.prompt) {
        throw new Error(data.error || "图片反推失败");
      }

      setReversePrompt(data.prompt);
      setPrompt(data.prompt);
      setReverseStatus("done");
    } catch (caught) {
      setReverseError(caught instanceof Error ? caught.message : "图片反推失败");
      setReverseStatus("error");
    }
  }

  async function optimizePrompt() {
    setStatus("optimizing");
    setError("");

    try {
      const response = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          textModel: config.textModel,
          style,
          idea
        })
      });
      const data = await response.json();

      if (!response.ok || !data.prompt) {
        throw new Error(data.error || "提示词优化失败");
      }

      setPrompt(data.prompt);
      setStatus("done");
    } catch (caught) {
      setPrompt(compactPrompt(style, idea));
      setError(`${caught instanceof Error ? caught.message : "提示词优化失败"}；已使用本地模板生成提示词。`);
      setStatus("error");
    }
  }

  async function generateImage() {
    setStatus("generating");
    setError("");
    setRawResponse(null);

    const requestPayload = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      ...payloadPreview
    };

    if (requestPayload.output_compression === undefined) {
      delete requestPayload.output_compression;
    }

    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "生成失败");
      }

      const nextImages = (await extractImages(data)).map((image) => ({
        ...image,
        prompt,
        model: config.imageModel
      }));
      if (!nextImages.length) {
        throw new Error("接口没有返回可显示的图片");
      }

      const mergedImages = [...nextImages, ...images].slice(0, 8);
      setImages(mergedImages);
      setActiveImage(nextImages[0]);
      await saveStoredImages(mergedImages);
      setRawResponse(sanitizeImageResponse(data));
      setStatus("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败");
      setStatus("error");
    }
  }

  const isGenerating = status === "generating";
  const isOptimizing = status === "optimizing";
  const isReversing = reverseStatus === "reversing";

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark"><Sparkles size={22} /></div>
            <div>
              <h1>Prompt Image Studio</h1>
              <p>本地提示词优化与出图工作台</p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">
              <KeyRound size={18} />
              <h2>连接</h2>
              <button className="icon-button" onClick={saveConfig} title="保存配置">
                <Save size={17} />
              </button>
            </div>
            <Field label="中转站链接">
              <input value={config.baseUrl} onChange={(event) => updateConfig("baseUrl", event.target.value)} placeholder="https://example.com/v1" />
            </Field>
            <Field label="API Key">
              <input type="password" value={config.apiKey} onChange={(event) => updateConfig("apiKey", event.target.value)} placeholder="sk-..." />
            </Field>
            <Field label="提示词模型名">
              <input value={config.textModel} onChange={(event) => updateConfig("textModel", event.target.value)} />
            </Field>
            <Field label="多模态模型名">
              <input value={config.visionModel} onChange={(event) => updateConfig("visionModel", event.target.value)} />
            </Field>
            <Field label="图片模型名">
              <input value={config.imageModel} onChange={(event) => updateConfig("imageModel", event.target.value)} />
            </Field>
            <p className="save-state">{status === "saved" ? "配置已保存到本机浏览器" : "配置只保存在本机浏览器 localStorage"}</p>
          </div>

          <div className="panel">
            <div className="panel-title">
              <Settings2 size={18} />
              <h2>图片参数</h2>
            </div>
            <Field label="尺寸">
              <select value={config.size} onChange={(event) => updateConfig("size", event.target.value)}>
                {sizes.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="质量">
              <select value={config.quality} onChange={(event) => updateConfig("quality", event.target.value)}>
                {qualities.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="背景">
              <select value={config.background} onChange={(event) => updateConfig("background", event.target.value)}>
                {backgrounds.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="输出格式">
              <select value={config.outputFormat} onChange={(event) => updateConfig("outputFormat", event.target.value)}>
                {formats.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="压缩">
              <input type="range" min="0" max="100" value={config.outputCompression} onChange={(event) => updateConfig("outputCompression", event.target.value)} />
            </Field>
            <Field label="审核">
              <select value={config.moderation} onChange={(event) => updateConfig("moderation", event.target.value)}>
                {moderations.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="张数">
              <input type="number" min="1" max="4" value={config.n} onChange={(event) => updateConfig("n", event.target.value)} />
            </Field>
          </div>
        </aside>

        <section className="main-stage">
          <div className="prompt-band">
            <div className="prompt-editor">
              <div className="section-heading">
                <Wand2 size={20} />
                <h2>提示词优化</h2>
              </div>
              <Field label="你想要的图片风格">
                <textarea className="style-input" value={style} onChange={(event) => setStyle(event.target.value)} />
              </Field>
              <div className="preset-row">
                {stylePresets.map((preset) => (
                  <button key={preset} onClick={() => setStyle(preset)}>{preset.slice(0, 12)}</button>
                ))}
              </div>
              <Field label="画面目标">
                <textarea value={idea} onChange={(event) => setIdea(event.target.value)} />
              </Field>
              <div className="action-row">
                <button className="secondary-button" onClick={optimizePrompt} disabled={isOptimizing}>
                  {isOptimizing ? <Loader2 className="spin" size={17} /> : <RotateCcw size={17} />}
                  优化提示词
                </button>
                <button className="primary-button" onClick={generateImage} disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="spin" size={18} /> : <Paintbrush size={18} />}
                  生成图片
                </button>
              </div>
            </div>

            <div className="prompt-output">
              <div className="section-heading">
                <Eye size={20} />
                <h2>最终发送 Prompt</h2>
              </div>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              {error && <div className="error-box">{error}</div>}
            </div>
          </div>

          <div className="reverse-panel">
            <div className="section-heading">
              <ImageIcon size={20} />
              <h2>图片反推提示词</h2>
            </div>
            <div className="reverse-grid">
              <div>
                <label className="upload-zone">
                  {reverseImage ? (
                    <img src={reverseImage.dataUrl} alt={reverseImage.name} />
                  ) : (
                    <span>
                      <ImageIcon size={34} />
                      上传参考图
                    </span>
                  )}
                  <input type="file" accept="image/*" onChange={handleReverseImage} />
                </label>
                {reverseImage && <p className="file-name">{reverseImage.name}</p>}
              </div>
              <div>
                <Field label="反推要求">
                  <textarea className="reverse-instruction" value={reverseInstruction} onChange={(event) => setReverseInstruction(event.target.value)} />
                </Field>
                <div className="action-row">
                  <button className="secondary-button" onClick={() => reversePrompt && setPrompt(reversePrompt)} disabled={!reversePrompt}>
                    <Save size={17} />
                    使用结果
                  </button>
                  <button className="primary-button" onClick={reversePromptFromImage} disabled={isReversing}>
                    {isReversing ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
                    反推提示词
                  </button>
                </div>
                {reverseError && <div className="error-box">{reverseError}</div>}
              </div>
              <div className="reverse-output">
                <Field label="反推结果">
                  <textarea value={reversePrompt} onChange={(event) => setReversePrompt(event.target.value)} placeholder="多模态模型解析出的提示词会显示在这里，并自动同步到最终发送 Prompt。" />
                </Field>
              </div>
            </div>
          </div>

          <div className="result-grid">
            <section className="preview-area">
              {activeImage ? (
                <>
                  <img src={activeImage.src} alt="Generated result" />
                  <div className="preview-toolbar">
                    <span>{config.imageModel}</span>
                    <a href={activeImage.src} download="prompt-image-studio.png" title="下载图片">
                      <Download size={18} />
                    </a>
                  </div>
                </>
              ) : (
                <div className="empty-preview">
                  <ImageIcon size={48} />
                  <p>图片生成后会显示在这里</p>
                </div>
              )}
            </section>

            <section className="history-panel">
              <div className="section-heading">
                <ImageIcon size={20} />
                <h2>结果与请求</h2>
              </div>
              <div className="thumbs">
                {images.map((image) => (
                  <button key={image.id} onClick={() => setActiveImage(image)} className={activeImage?.id === image.id ? "active" : ""}>
                    <img src={image.src} alt="history item" />
                  </button>
                ))}
              </div>
              <pre>{JSON.stringify(payloadPreview, null, 2)}</pre>
              {rawResponse && <details><summary>原始返回</summary><pre>{JSON.stringify(rawResponse, null, 2)}</pre></details>}
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
const root = window.__promptImageStudioRoot || createRoot(rootElement);
window.__promptImageStudioRoot = root;
root.render(<App />);
