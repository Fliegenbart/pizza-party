import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeScrapeTarget } from "../lib/scraper.ts";

test("blocks localhost and private network targets", async () => {
  assert.equal(await isSafeScrapeTarget("http://localhost:3000"), false);
  assert.equal(await isSafeScrapeTarget("http://127.0.0.1"), false);
  assert.equal(await isSafeScrapeTarget("http://10.0.0.5"), false);
  assert.equal(await isSafeScrapeTarget("http://192.168.0.1"), false);
  assert.equal(await isSafeScrapeTarget("http://[::1]"), false);
});

test("blocks non-http protocols", async () => {
  assert.equal(await isSafeScrapeTarget("file:///etc/passwd"), false);
});

test("allows normal public web targets", async () => {
  assert.equal(await isSafeScrapeTarget("https://example.com"), true);
});
