import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  addCardImage,
  createCard,
  createPreset,
  deletePreset,
  getCard,
  listCards,
  listPresets,
  updateCard,
  updatePreset,
} from "./db.js";
import { buildMessages, streamChat } from "./apimart.js";
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  MAX_IMAGE_BYTES,
  canStartRun,
  validateImage,
} from "./logic.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 12 },
});

function sendJsonError(res, status, message) {
  res.status(status).json({ error: message });
}

function extOf(mime, original) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return path.extname(original || "") || ".bin";
}

function saveImages(dataDir, cardId, files) {
  const dir = path.join(dataDir, "uploads", String(cardId));
  fs.mkdirSync(dir, { recursive: true });
  return (files || []).map((file, index) => {
    const filename = `${String(index).padStart(2, "0")}${extOf(file.mimetype, file.originalname)}`;
    fs.writeFileSync(path.join(dir, filename), file.buffer);
    return {
      file_path: `${cardId}/${filename}`,
      original_name: file.originalname || filename,
      mime: file.mimetype,
      sort_order: index,
    };
  });
}

function readImagesForModel(dataDir, images) {
  return images.map((img) => ({
    mime: img.mime,
    base64: fs.readFileSync(path.join(dataDir, "uploads", img.file_path)).toString("base64"),
  }));
}

async function runCard(db, dataDir, env, card, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "card", card })}\n\n`);

  if (!env.apiKey) {
    const failed = updateCard(db, card.id, {
      status: "failed",
      error: "未配置 APIMART_API_KEY",
    });
    res.write(`data: ${JSON.stringify({ type: "done", card: failed })}\n\n`);
    res.end();
    return;
  }

  try {
    const messages = buildMessages({
      systemPrompt: card.system_prompt,
      userText: card.user_text,
      images: readImagesForModel(dataDir, card.images),
    });
    const output = await streamChat({
      apiKey: env.apiKey,
      baseUrl: env.baseUrl,
      model: card.model,
      messages,
      onDelta(_piece, full) {
        updateCard(db, card.id, { output: full, status: "running" });
        res.write(`data: ${JSON.stringify({ type: "delta", text: full })}\n\n`);
      },
    });
    const done = updateCard(db, card.id, { output, status: "succeeded", error: "" });
    res.write(`data: ${JSON.stringify({ type: "done", card: done })}\n\n`);
  } catch (err) {
    const failed = updateCard(db, card.id, {
      status: "failed",
      error: err.message || String(err),
    });
    res.write(`data: ${JSON.stringify({ type: "done", card: failed })}\n\n`);
  }
  res.end();
}

export function createApp({ db, dataDir, apiKey, baseUrl }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const env = {
    apiKey,
    baseUrl: baseUrl || "https://api.apimart.ai/v1",
  };

  app.get("/api/models", (_req, res) => {
    res.json({ defaultModel: DEFAULT_MODEL, options: MODEL_OPTIONS });
  });

  app.get("/api/presets", (_req, res) => {
    res.json(listPresets(db));
  });

  app.post("/api/presets", (req, res) => {
    try {
      res.status(201).json(createPreset(db, req.body || {}));
    } catch (err) {
      sendJsonError(res, 400, err.message);
    }
  });

  app.put("/api/presets/:id", (req, res) => {
    try {
      const row = updatePreset(db, Number(req.params.id), req.body || {});
      if (!row) return sendJsonError(res, 404, "预设不存在");
      res.json(row);
    } catch (err) {
      sendJsonError(res, 400, err.message);
    }
  });

  app.delete("/api/presets/:id", (req, res) => {
    deletePreset(db, Number(req.params.id));
    res.status(204).end();
  });

  app.get("/api/cards", (req, res) => {
    res.json(listCards(db, String(req.query.q || "")));
  });

  app.get("/api/cards/:id", (req, res) => {
    const card = getCard(db, Number(req.params.id));
    if (!card) return sendJsonError(res, 404, "卡片不存在");
    res.json(card);
  });

  app.post("/api/cards", upload.array("images", 12), async (req, res) => {
    const files = req.files || [];
    for (const file of files) {
      const check = validateImage({ mime: file.mimetype, size: file.size });
      if (!check.ok) return sendJsonError(res, 400, check.error);
    }
    const body = req.body || {};
    const userText = String(body.user_text || "");
    if (!canStartRun({ userText, imageCount: files.length })) {
      return sendJsonError(res, 400, "请至少上传一张图或输入一段文字");
    }
    const card = createCard(db, {
      user_text: userText,
      system_prompt: String(body.system_prompt || ""),
      preset_id: body.preset_id ? Number(body.preset_id) : null,
      preset_name: body.preset_name || null,
      model: String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
      source_card_id: body.source_card_id ? Number(body.source_card_id) : null,
    });
    for (const img of saveImages(dataDir, card.id, files)) {
      addCardImage(db, card.id, img);
    }
    const fresh = getCard(db, card.id);
    await runCard(db, dataDir, env, fresh, res);
  });

  app.post("/api/cards/:id/retry", upload.array("images", 12), async (req, res) => {
    const card = getCard(db, Number(req.params.id));
    if (!card) return sendJsonError(res, 404, "卡片不存在");
    const files = req.files || [];
    for (const file of files) {
      const check = validateImage({ mime: file.mimetype, size: file.size });
      if (!check.ok) return sendJsonError(res, 400, check.error);
    }
    const body = req.body || {};
    const userText = body.user_text != null ? String(body.user_text) : card.user_text;
    const imageCount = files.length || card.images.length;
    if (!canStartRun({ userText, imageCount })) {
      return sendJsonError(res, 400, "请至少上传一张图或输入一段文字");
    }
    if (files.length) {
      db.prepare("DELETE FROM card_images WHERE card_id = ?").run(card.id);
      for (const img of saveImages(dataDir, card.id, files)) {
        addCardImage(db, card.id, img);
      }
    }
    const next = updateCard(db, card.id, {
      user_text: userText,
      system_prompt: body.system_prompt != null ? String(body.system_prompt) : card.system_prompt,
      preset_id: body.preset_id ? Number(body.preset_id) : card.preset_id,
      preset_name: body.preset_name != null ? body.preset_name : card.preset_name,
      model: body.model ? String(body.model).trim() : card.model,
      output: "",
      error: "",
      status: "running",
    });
    await runCard(db, dataDir, env, next, res);
  });

  app.use("/uploads", express.static(path.join(dataDir, "uploads")));
  app.use((err, _req, res, next) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "单张图片不能超过 10MB" : err.message;
      return sendJsonError(res, 400, message);
    }
    next(err);
  });
  return app;
}
