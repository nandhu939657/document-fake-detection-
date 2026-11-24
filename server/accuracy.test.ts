import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolvePythonCommand } from "./pythonRuntime";

type EvalResult = {
  passed: boolean;
  checks: Record<string, boolean>;
  rows: Array<{ file: string; label: string; score: number | null; decision: string }>;
};

describe("forgery score regression", () => {
  it("separates the labeled fakes from the labeled genuine samples", () => {
    const output = execFileSync(resolvePythonCommand(), ["scripts/eval_samples.py", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 300_000,
    });
    const result = JSON.parse(output) as EvalResult;
    expect(result.checks).toMatchObject({
      model_loaded: true,
      fakes_outscore_genuine: true,
      at_least_one_fake_forged: true,
      no_genuine_forged: true,
      obvious_fakes_outscore_genuine: true,
    });
    expect(result.passed).toBe(true);
  }, 300_000);
});
