import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessages } from "./apimart.js";
import { EMPTY_IMAGE_USER_TEXT } from "./logic.js";

test("buildMessages adds system only when non-empty", () => {
  const none = buildMessages({ systemPrompt: "  ", userText: "hello", images: [] });
  assert.equal(none[0].role, "user");
  const withSys = buildMessages({ systemPrompt: "你是反推助手", userText: "hello", images: [] });
  assert.equal(withSys[0].role, "system");
  assert.equal(withSys[0].content, "你是反推助手");
});

test("buildMessages uses image placeholder when text is empty", () => {
  const msgs = buildMessages({
    systemPrompt: "",
    userText: "",
    images: [{ mime: "image/png", base64: "abc" }],
  });
  assert.equal(msgs[0].content[0].text, EMPTY_IMAGE_USER_TEXT);
  assert.equal(msgs[0].content[1].image_url.url, "data:image/png;base64,abc");
});
