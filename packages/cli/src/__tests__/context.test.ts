import { describe, expect, it } from "vitest";
import { createCliContext, detectTargetBranch } from "../context.js";

describe("detectTargetBranch (criterion 7.10)", () => {
  it("prefers VELLUM_TARGET_BRANCH, then GitHub's, then GitLab's, skipping empty values", () => {
    expect(detectTargetBranch({})).toBeUndefined();
    expect(detectTargetBranch({ GITHUB_BASE_REF: "" })).toBeUndefined();
    expect(detectTargetBranch({ GITHUB_BASE_REF: "main" })).toBe("main");
    expect(detectTargetBranch({ CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "develop" })).toBe("develop");
    expect(
      detectTargetBranch({ VELLUM_TARGET_BRANCH: "release", GITHUB_BASE_REF: "main" }),
    ).toBe("release");
    expect(detectTargetBranch({ VELLUM_TARGET_BRANCH: " ", GITHUB_BASE_REF: "main" })).toBe("main");
  });

  it("sets the context's target branch only when one is named", () => {
    expect(createCliContext({}, {}).targetBranch).toBeUndefined();
    expect(createCliContext({}, { GITHUB_BASE_REF: "main" }).targetBranch).toBe("main");
  });
});
