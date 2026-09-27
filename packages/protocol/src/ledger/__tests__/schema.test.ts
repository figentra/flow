/**
 * Ledger Schema tests.
 *
 * @see requirements.md Requirements 4.11, 9.3
 */

import { describe, it, expect } from "vitest";
import { validateLedgerEntry, EVIDENCE_FORBIDDEN_FIELDS } from "../schema.js";

describe("Ledger Schema (Task 4.3)", () => {
  describe("validateLedgerEntry", () => {
    describe("approval kind", () => {
      it("should pass for valid approval entry", () => {
        const entry = {
          kind: "approval",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          artifact: "requirements.md",
          artifact_version: 1,
          artifact_checksum: "a".repeat(64),
          identity: "test@example.com",
          identity_key: "ABCD1234",
          session_type: "human",
          approval_signal: {
            commit: "b".repeat(40),
            message_prefix: "approve:",
          },
        };

        const findings = validateLedgerEntry(entry);
        expect(findings).toEqual([]);
      });

      it("should fail for missing artifact field", () => {
        const entry = {
          kind: "approval",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          artifact_version: 1,
          artifact_checksum: "a".repeat(64),
          identity: "test@example.com",
          identity_key: "ABCD1234",
          session_type: "human",
          approval_signal: {
            commit: "b".repeat(40),
            message_prefix: "approve:",
          },
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.some((f) => f.field === "artifact")).toBe(true);
      });
    });

    describe("evidence kind", () => {
      it("should pass for valid evidence entry", () => {
        const entry = {
          kind: "evidence",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          task_id: "2.1",
          command: "pnpm test",
          exit_status: 0,
          start_timestamp: "2026-09-25T12:00:00.000Z",
          finish_timestamp: "2026-09-25T12:00:05.000Z",
          commit: "a".repeat(40),
          affected_paths: ["src/engine/git-reader.ts"],
          environment_versions: {
            platform: "0.1.0",
            schema: "1.0",
            node: "22.0.0",
          },
          uncommitted: false,
        };

        const findings = validateLedgerEntry(entry);
        expect(findings).toEqual([]);
      });

      it("should fail when stdout field present (Requirement 9.3)", () => {
        const entry = {
          kind: "evidence",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          task_id: "2.1",
          command: "pnpm test",
          exit_status: 0,
          start_timestamp: "2026-09-25T12:00:00.000Z",
          finish_timestamp: "2026-09-25T12:00:05.000Z",
          commit: "a".repeat(40),
          affected_paths: ["src/engine/git-reader.ts"],
          environment_versions: {
            platform: "0.1.0",
            schema: "1.0",
            node: "22.0.0",
          },
          uncommitted: false,
          stdout: "test output",
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.some((f) => f.field === "stdout")).toBe(true);
        expect(findings.some((f) => f.message.includes("9.3"))).toBe(true);
      });

      it("should fail when stderr field present (Requirement 9.3)", () => {
        const entry = {
          kind: "evidence",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          task_id: "2.1",
          command: "pnpm test",
          exit_status: 1,
          start_timestamp: "2026-09-25T12:00:00.000Z",
          finish_timestamp: "2026-09-25T12:00:05.000Z",
          commit: "a".repeat(40),
          affected_paths: ["src/engine/git-reader.ts"],
          environment_versions: {
            platform: "0.1.0",
            schema: "1.0",
            node: "22.0.0",
          },
          uncommitted: false,
          stderr: "error output",
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.some((f) => f.field === "stderr")).toBe(true);
      });

      it("should fail for invalid exit_status (out of range)", () => {
        const entry = {
          kind: "evidence",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          task_id: "2.1",
          command: "pnpm test",
          exit_status: 300,
          start_timestamp: "2026-09-25T12:00:00.000Z",
          finish_timestamp: "2026-09-25T12:00:05.000Z",
          commit: "a".repeat(40),
          affected_paths: ["src/engine/git-reader.ts"],
          environment_versions: {
            platform: "0.1.0",
            schema: "1.0",
            node: "22.0.0",
          },
          uncommitted: false,
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "exit_status")).toBe(true);
      });
    });

    describe("decision kind", () => {
      it("should pass for valid decision entry", () => {
        const entry = {
          kind: "decision",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          decision: "Use Vite for builds",
          rationale: "Vite provides fast development experience",
          blocking: false,
        };

        const findings = validateLedgerEntry(entry);
        expect(findings).toEqual([]);
      });

      it("should fail for missing blocking field", () => {
        const entry = {
          kind: "decision",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          decision: "Use Vite for builds",
          rationale: "Vite provides fast development experience",
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "blocking")).toBe(true);
      });
    });

    describe("rejection kind", () => {
      it("should pass for valid rejection entry", () => {
        const entry = {
          kind: "rejection",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          artifact: "design.md",
          artifact_version: 1,
          identity: "test@example.com",
          rationale: "Design does not address scalability concerns",
        };

        const findings = validateLedgerEntry(entry);
        expect(findings).toEqual([]);
      });
    });

    describe("header fields", () => {
      it("should fail for missing kind field", () => {
        const entry = {
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "kind")).toBe(true);
      });

      it("should fail for invalid kind value", () => {
        const entry = {
          kind: "invalid_kind",
          id: 1,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "kind")).toBe(true);
      });

      it("should fail for missing id field", () => {
        const entry = {
          kind: "decision",
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          decision: "Test",
          rationale: "Test rationale",
          blocking: false,
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "id")).toBe(true);
      });

      it("should fail for non-integer id", () => {
        const entry = {
          kind: "decision",
          id: 1.5,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          decision: "Test",
          rationale: "Test rationale",
          blocking: false,
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "id")).toBe(true);
      });

      it("should fail for zero or negative id", () => {
        const entry = {
          kind: "decision",
          id: 0,
          predecessor_digest: null,
          timestamp: "2026-09-25T12:00:00.000Z",
          decision: "Test",
          rationale: "Test rationale",
          blocking: false,
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "id")).toBe(true);
      });

      it("should fail for invalid timestamp", () => {
        const entry = {
          kind: "decision",
          id: 1,
          predecessor_digest: null,
          timestamp: "not-a-date",
          decision: "Test",
          rationale: "Test rationale",
          blocking: false,
        };

        const findings = validateLedgerEntry(entry);
        expect(findings.some((f) => f.field === "timestamp")).toBe(true);
      });
    });
  });

  describe("task_binding entries", () => {
    const binding = {
      kind: "task_binding",
      id: 2,
      predecessor_digest: "a".repeat(64),
      timestamp: "2026-09-26T10:00:00Z",
      task_id: "1",
      requirements_version: 1,
      requirements_checksum: "b".repeat(64),
      design_version: 1,
      design_checksum: "c".repeat(64),
      plan_version: 1,
      plan_checksum: "d".repeat(64),
    };

    it("accepts a complete binding", () => {
      expect(validateLedgerEntry(binding)).toEqual([]);
    });

    it("names a missing checksum field", () => {
      const { plan_checksum: _drop, ...partial } = binding;
      expect(validateLedgerEntry(partial).map((f) => f.field)).toEqual(["plan_checksum"]);
    });

    it("accepts checksum_form 1 or 2 and names any other value", () => {
      expect(validateLedgerEntry({ ...binding, checksum_form: 2 })).toEqual([]);
      expect(validateLedgerEntry({ ...binding, checksum_form: 1 })).toEqual([]);
      expect(validateLedgerEntry({ ...binding, checksum_form: "2" }).map((f) => f.field)).toEqual([
        "checksum_form",
      ]);
    });
  });

  describe("checksum_form on approval entries", () => {
    const approval = {
      kind: "approval",
      id: 2,
      predecessor_digest: "a".repeat(64),
      timestamp: "2026-09-26T10:00:00Z",
      artifact: "requirements.md",
      artifact_version: 1,
      artifact_checksum: "b".repeat(64),
      identity: "test@example.com",
      identity_key: "SHA256:abc",
      session_type: "human",
      approval_signal: { commit: null, message_prefix: "approve:" },
    };

    it("is optional: an entry without it is form 1, as Vellum 0.1.2 wrote it", () => {
      expect(validateLedgerEntry(approval)).toEqual([]);
      expect(validateLedgerEntry({ ...approval, checksum_form: 2 })).toEqual([]);
    });

    it("names a form this version does not know", () => {
      expect(validateLedgerEntry({ ...approval, checksum_form: 3 }).map((f) => f.field)).toEqual([
        "checksum_form",
      ]);
    });
  });

  describe("adoption kind", () => {
    const adoption = {
      kind: "adoption",
      id: 1,
      predecessor_digest: null,
      timestamp: "2026-09-27T10:00:00Z",
      from: "legacy",
      to: "managed",
    };

    it("accepts the entry vellum adopt writes", () => {
      expect(validateLedgerEntry(adoption)).toEqual([]);
    });

    it("names a missing or wrong direction", () => {
      const { to: _drop, ...partial } = adoption;
      expect(validateLedgerEntry(partial).map((f) => f.field)).toEqual(["to", "to"]);
      expect(validateLedgerEntry({ ...adoption, from: "managed" }).map((f) => f.field)).toEqual([
        "from",
      ]);
    });
  });

  describe("EVIDENCE_FORBIDDEN_FIELDS", () => {
    it("should list stdout and stderr", () => {
      expect(EVIDENCE_FORBIDDEN_FIELDS).toContain("stdout");
      expect(EVIDENCE_FORBIDDEN_FIELDS).toContain("stderr");
    });
  });
});
