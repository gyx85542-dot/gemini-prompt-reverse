import { DatabaseSync } from "node:sqlite";
import { cardMatchesQuery } from "./logic.js";

export function openDb(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      user_text TEXT,
      system_prompt TEXT,
      preset_id INTEGER,
      preset_name TEXT,
      model TEXT NOT NULL,
      output TEXT,
      error TEXT,
      source_card_id INTEGER,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS card_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id)
    );
  `);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function imagesOf(db, cardId) {
  return db
    .prepare(
      "SELECT id, card_id, file_path, original_name, mime, sort_order FROM card_images WHERE card_id = ? ORDER BY sort_order ASC, id ASC"
    )
    .all(cardId);
}

function withImages(db, card) {
  if (!card) return null;
  return { ...card, images: imagesOf(db, card.id) };
}

export function listPresets(db) {
  return db
    .prepare("SELECT id, name, body, updated_at FROM presets ORDER BY updated_at DESC, id DESC")
    .all();
}

export function createPreset(db, { name, body }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("预设名称不能为空");
  const updated_at = nowIso();
  const result = db
    .prepare("INSERT INTO presets (name, body, updated_at) VALUES (?, ?, ?)")
    .run(trimmed, String(body || ""), updated_at);
  return db.prepare("SELECT id, name, body, updated_at FROM presets WHERE id = ?").get(result.lastInsertRowid);
}

export function updatePreset(db, id, { name, body }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("预设名称不能为空");
  db.prepare("UPDATE presets SET name = ?, body = ?, updated_at = ? WHERE id = ?").run(
    trimmed,
    String(body || ""),
    nowIso(),
    id
  );
  return db.prepare("SELECT id, name, body, updated_at FROM presets WHERE id = ?").get(id);
}

export function deletePreset(db, id) {
  db.prepare("DELETE FROM presets WHERE id = ?").run(id);
}

export function createCard(db, data) {
  const created_at = nowIso();
  const result = db
    .prepare(
      `INSERT INTO cards (created_at, user_text, system_prompt, preset_id, preset_name, model, output, error, source_card_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      created_at,
      data.user_text ?? "",
      data.system_prompt ?? "",
      data.preset_id ?? null,
      data.preset_name ?? null,
      data.model,
      "",
      "",
      data.source_card_id ?? null,
      "running"
    );
  return getCard(db, result.lastInsertRowid);
}

export function updateCard(db, id, patch) {
  const current = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  db.prepare(
    `UPDATE cards SET user_text = ?, system_prompt = ?, preset_id = ?, preset_name = ?, model = ?, output = ?, error = ?, source_card_id = ?, status = ?
     WHERE id = ?`
  ).run(
    next.user_text,
    next.system_prompt,
    next.preset_id,
    next.preset_name,
    next.model,
    next.output,
    next.error,
    next.source_card_id,
    next.status,
    id
  );
  return getCard(db, id);
}

export function getCard(db, id) {
  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  return withImages(db, row);
}

export function listCards(db, query) {
  const rows = db.prepare("SELECT * FROM cards ORDER BY created_at DESC, id DESC").all();
  return rows.map((row) => withImages(db, row)).filter((card) => cardMatchesQuery(card, query));
}

export function addCardImage(db, cardId, { file_path, original_name, mime, sort_order }) {
  const result = db
    .prepare(
      "INSERT INTO card_images (card_id, file_path, original_name, mime, sort_order) VALUES (?, ?, ?, ?, ?)"
    )
    .run(cardId, file_path, original_name, mime, sort_order);
  return db.prepare("SELECT * FROM card_images WHERE id = ?").get(result.lastInsertRowid);
}
