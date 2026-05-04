import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMailResponseContent } from "../lib/claude.ts";

test("parses structured Claude tool output without JSON parsing", () => {
  const result = parseMailResponseContent([
    {
      type: "tool_use",
      name: "write_krossmail",
      input: {
        companySummary: "Die Firma baut Software.",
        hook: "Die Website stellt gute Nutzung in den Vordergrund.",
        subject: "Pizza vor der Bürotür?",
        mailBody: "Sehr geehrte Frau Müller,\n\nkurzer Hook.\n\nhttps://chrisskross.de",
      },
    },
  ]);

  assert.equal(result.subject, "Pizza vor der Bürotür?");
  assert.equal(result.mailBody.includes("https://chrisskross.de"), true);
  assert.equal(result.companySummary, "Die Firma baut Software.");
  assert.equal(result.hook, "Die Website stellt gute Nutzung in den Vordergrund.");
});

test("fails clearly when Claude does not return the forced mail tool", () => {
  assert.throws(
    () => parseMailResponseContent([{ type: "text", text: "not json" }]),
    /No write_krossmail tool response/
  );
});
