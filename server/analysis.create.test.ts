import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  createDocumentAnalysis: vi.fn(),
  getDocumentAnalysisById: vi.fn(),
  listDocumentAnalyses: vi.fn(),
  storagePut: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./db", () => mocks);
vi.mock("./storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { end: (input: string) => void } };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {
      const output = { prediction: "forged", forgeryScore: 88, tamperingTypes: ["tampered text"], flaggedRegions: [{ label: "tampered text", confidence: 0.88, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }], overlayBase64: Buffer.from("overlay").toString("base64"), modelVersion: "DocTamper/DTD official checkpoint" };
      child.stdout.emit("data", Buffer.from(JSON.stringify(output)));
      child.emit("close", 0);
    } };
    return child;
  },
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const context: TrpcContext = {
  user: { id: 9, openId: "reviewer", name: "Reviewer", email: "reviewer@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("analysis.create orchestration", () => {
  it("persists the overlay, model result, and required LLM explanation", async () => {
    mocks.storagePut.mockResolvedValueOnce({ key: "original-key", url: "/original" }).mockResolvedValueOnce({ key: "overlay-key", url: "/overlay" });
    mocks.invokeLLM.mockResolvedValue({ choices: [{ message: { content: "The document contains a suspicious text region." } }] });
    mocks.createDocumentAnalysis.mockResolvedValue({ id: 12, userId: 9, fileName: "certificate.png", prediction: "forged", forgeryScore: 88, explanation: "The document contains a suspicious text region." });

    const caller = appRouter.createCaller(context);
    const result = await caller.analysis.create({ fileName: "certificate.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" });

    expect(mocks.storagePut).toHaveBeenCalledTimes(2);
    expect(mocks.invokeLLM).toHaveBeenCalledOnce();
    expect(mocks.createDocumentAnalysis).toHaveBeenCalledWith(expect.objectContaining({ userId: 9, prediction: "forged", forgeryScore: 88, explanation: "The document contains a suspicious text region." }));
    expect(result).toMatchObject({ id: 12, prediction: "forged" });
  });
});
