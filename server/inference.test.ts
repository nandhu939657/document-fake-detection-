import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("python document inference adapter", () => {
  it("returns an explainable analysis payload with an overlay", () => {
    const output = execFileSync("python3", ["scripts/infer_document.py"], {
      cwd: process.cwd(),
      input: onePixelPng,
      encoding: "utf8",
    });
    const result = JSON.parse(output) as Record<string, unknown>;
    expect(["genuine", "forged"]).toContain(result.prediction);
    expect(result.forgeryScore).toEqual(expect.any(Number));
    expect(result.tamperingTypes).toEqual(expect.any(Array));
    expect(result.flaggedRegions).toEqual(expect.any(Array));
    expect(result.overlayBase64).toEqual(expect.any(String));
    expect(["dtd-checkpoint-mounted-runtime-ready", "dtd-checkpoint-mounted-runtime-unavailable", "dtd-checkpoint-missing"]).toContain(result.modelStatus);
    expect(result.flaggedRegions).toEqual(expect.arrayContaining([expect.objectContaining({ label: expect.any(String), confidence: expect.any(Number) })]));
    expect(String(result.overlayBase64).length).toBeGreaterThan(20);
  });
});
