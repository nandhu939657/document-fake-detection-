import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolvePythonCommand } from "./pythonRuntime";

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("python document inference adapter", () => {
  it("returns an explainable analysis payload with an overlay", () => {
    const output = execFileSync(resolvePythonCommand(), ["scripts/infer_document.py"], {
      cwd: process.cwd(),
      input: onePixelPng,
      encoding: "utf8",
    });
    const result = JSON.parse(output) as Record<string, unknown>;
    expect(["genuine", "forged"]).toContain(result.prediction);
    expect(["genuine", "review", "forged"]).toContain(result.decision);
    expect(result.forgeryScore).toEqual(expect.any(Number));
    expect(result.tamperingTypes).toEqual(expect.any(Array));
    expect(result.flaggedRegions).toEqual(expect.any(Array));
    expect(result.overlayBase64).toEqual(expect.any(String));
    expect([
      "unet-checkpoint-mounted-runtime-unavailable",
      "unet-runtime-active",
      "baseline-visual-fallback",
    ]).toContain(result.modelStatus);
    const regions = result.flaggedRegions as Array<Record<string, unknown>>;
    if (regions.length > 0) {
      expect(regions).toEqual(expect.arrayContaining([expect.objectContaining({ label: expect.any(String), confidence: expect.any(Number) })]));
    }
    expect(String(result.overlayBase64).length).toBeGreaterThan(20);
  });
});
