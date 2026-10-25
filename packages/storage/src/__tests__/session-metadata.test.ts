/**
 * parseSessionMetadata: the markers that make a commit an assistant's, so its
 * Approval Signal is rejected (criterion 7.8) — including the trailer Claude
 * Code actually writes.
 */

import { describe, expect, it } from "vitest";
import { parseSessionMetadata } from "../git.ts";

describe("parseSessionMetadata", () => {
  it("reads Claude Code's Co-Authored-By trailer, in any case and with any model name", () => {
    for (const [trailer, name] of [
      ["Co-Authored-By: Claude <noreply@anthropic.com>", "Claude"],
      ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", "Claude Opus 5.5"],
      ["co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>", "Claude Sonnet 4.5"],
      ["Co-authored-by: <noreply@anthropic.com>", "Claude"],
    ] as const) {
      expect(parseSessionMetadata(`approve: requirements\n\n${trailer}`), trailer).toEqual({
        isAssistant: true,
        assistantName: name,
      });
    }
  });

  it("reads Claude Code's Generated with line", () => {
    expect(
      parseSessionMetadata("approve: design\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"),
    ).toEqual({ isAssistant: true, assistantName: "Claude Code" });
  });

  it("still reads the Assistant: trailer and the [name: assistant] tag", () => {
    expect(parseSessionMetadata("x\n\nAssistant: kiro")).toEqual({ isAssistant: true, assistantName: "kiro" });
    expect(parseSessionMetadata("x\n\nCo-Authored-By: Bot <b@example.com> [opencode: assistant]")).toEqual({
      isAssistant: true,
      assistantName: "opencode",
    });
  });

  it("leaves a human's commit, and a human co-author, alone", () => {
    expect(parseSessionMetadata("approve: tasks")).toBeUndefined();
    expect(parseSessionMetadata("approve: tasks\n\nCo-Authored-By: Alice <alice@example.com>")).toBeUndefined();
    // The address must be the trailer's address, not text elsewhere.
    expect(parseSessionMetadata("approve: tasks\n\nmentions noreply@anthropic.com in passing")).toBeUndefined();
  });
});
