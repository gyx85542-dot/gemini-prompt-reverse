import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canStartRun,
  cardMatchesQuery,
  validateImage,
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  EMPTY_IMAGE_USER_TEXT,
} from "./logic.js";

test("canStartRun rejects empty text and no images", () => {
  assert.equal(canStartRun({ userText: "  ", imageCount: 0 }), false);
});

test("canStartRun accepts text only or images only", () => {
  assert.equal(canStartRun({ userText: "一只猫", imageCount: 0 }), true);
  assert.equal(canStartRun({ userText: "", imageCount: 1 }), true);
});

test("cardMatchesQuery is case-insensitive over text, system prompt, output", () => {
  const card = {
    user_text: "Red chair",
    system_prompt: "反推镜头",
    output: "35mm film",
  };
  assert.equal(cardMatchesQuery(card, ""), true);
  assert.equal(cardMatchesQuery(card, "CHAIR"), true);
  assert.equal(cardMatchesQuery(card, "镜头"), true);
  assert.equal(cardMatchesQuery(card, "35MM"), true);
  assert.equal(cardMatchesQuery(card, "不存在"), false);
});

test("validateImage accepts common types under 10MB and rejects others", () => {
  assert.deepEqual(validateImage({ mime: "image/png", size: 100 }), { ok: true });
  assert.equal(validateImage({ mime: "image/gif", size: 10 * 1024 * 1024 }).ok, true);
  assert.equal(validateImage({ mime: "image/png", size: 10 * 1024 * 1024 + 1 }).ok, false);
  assert.equal(validateImage({ mime: "application/pdf", size: 10 }).ok, false);
});

test("default model and options match the spec", () => {
  assert.equal(DEFAULT_MODEL, "gemini-3.5-flash");
  assert.ok(MODEL_OPTIONS.includes("gemini-3.5-flash"));
  assert.ok(MODEL_OPTIONS.includes("gemini-2.5-pro"));
  assert.equal(EMPTY_IMAGE_USER_TEXT, "请根据图片进行反推。");
});
