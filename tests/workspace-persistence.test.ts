import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
} from "../lib/workspacePersistence.ts";
import type { Lead } from "../lib/types.ts";

const lead: Lead = {
  id: "lead-1",
  firstName: "Anna",
  lastName: "Müller",
  email: "anna@example.com",
  company: "Example GmbH",
  status: "ready",
  subject: "Pizza?",
  mailBody: "Hallo",
};

test("restores saved leads and file name after reload", () => {
  const snapshot = createWorkspaceSnapshot({
    fileName: "leads.csv",
    leads: [lead],
    stage: "done",
  });

  const restored = restoreWorkspaceSnapshot(JSON.stringify(snapshot));

  assert.equal(restored?.fileName, "leads.csv");
  assert.equal(restored?.stage, "done");
  assert.equal(restored?.leads[0]?.subject, "Pizza?");
});

test("turns in-flight work back into a resumable ready state", () => {
  const snapshot = createWorkspaceSnapshot({
    fileName: "leads.csv",
    leads: [{ ...lead, status: "enriching" }],
    stage: "enriching",
  });

  const restored = restoreWorkspaceSnapshot(JSON.stringify(snapshot));

  assert.equal(restored?.stage, "ready");
  assert.equal(restored?.leads[0]?.status, "pending");
});

test("ignores invalid persisted data", () => {
  assert.equal(restoreWorkspaceSnapshot("not json"), null);
  assert.equal(restoreWorkspaceSnapshot(JSON.stringify({ version: 1, leads: [] })), null);
});
