import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUploadFile } from "../lib/uploadValidation.ts";

test("accepts CSV and Excel uploads below the size limit", () => {
  assert.equal(validateUploadFile({ name: "leads.csv", size: 1024 }).ok, true);
  assert.equal(validateUploadFile({ name: "leads.xlsx", size: 1024 }).ok, true);
  assert.equal(validateUploadFile({ name: "leads.xls", size: 1024 }).ok, true);
});

test("rejects unsupported upload file types", () => {
  const result = validateUploadFile({ name: "leads.pdf", size: 1024 });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("rejects uploads that are too large", () => {
  const result = validateUploadFile({ name: "leads.csv", size: 5 * 1024 * 1024 + 1 });

  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});
