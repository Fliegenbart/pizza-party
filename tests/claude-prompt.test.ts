import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const claudeSource = readFileSync(new URL("../lib/claude.ts", import.meta.url), "utf8");

test("prompt requires website and Instagram links in each mail", () => {
  assert.match(claudeSource, /https:\/\/chrisskross\.de/);
  assert.match(claudeSource, /https:\/\/www\.instagram\.com\/chrisskrosspizza\/\?hl=de/);
});

test("salutation uses Herr/Frau with last name and omits first name", () => {
  assert.match(claudeSource, /Sehr geehrte Frau \$\{lead\.lastName\}/);
  assert.match(claudeSource, /Sehr geehrter Herr \$\{lead\.lastName\}/);
  assert.doesNotMatch(claudeSource, /Hallo \$\{lead\.firstName\}/);
});

test("unclear salutation stays neutral and still omits first name", () => {
  assert.match(claudeSource, /return `Guten Tag`/);
});

test("prompt asks for a sympathetic and less salesy tone", () => {
  assert.match(claudeSource, /weniger werblich/i);
  assert.match(claudeSource, /sympathisch/i);
  assert.match(claudeSource, /kein Sales-Druck/i);
});
