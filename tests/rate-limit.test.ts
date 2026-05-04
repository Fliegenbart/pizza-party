import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRateLimiter } from "../lib/rateLimit.ts";

test("allows requests until the configured limit is reached", () => {
  const limiter = createMemoryRateLimiter();

  assert.equal(limiter.check("client-a", 2, 60_000, 1_000).allowed, true);
  assert.equal(limiter.check("client-a", 2, 60_000, 2_000).allowed, true);
  assert.equal(limiter.check("client-a", 2, 60_000, 3_000).allowed, false);
});

test("allows requests again after the window resets", () => {
  const limiter = createMemoryRateLimiter();

  limiter.check("client-a", 1, 60_000, 1_000);
  assert.equal(limiter.check("client-a", 1, 60_000, 2_000).allowed, false);
  assert.equal(limiter.check("client-a", 1, 60_000, 62_000).allowed, true);
});
