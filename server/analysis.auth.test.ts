import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  listDocumentAnalyses: vi.fn().mockResolvedValue([]),
  createDocumentAnalysis: vi.fn().mockResolvedValue({
    id: 1,
    userId: 1,
    fileName: "certificate.png",
    prediction: "genuine",
    forgeryScore: 12,
  }),
  getDocumentAnalysisById: vi.fn(),
  getOrCreateGuestUser: vi.fn().mockResolvedValue({
    id: 1,
    openId: "guest_user",
    name: "Guest Reviewer",
  }),
  storagePut: vi.fn().mockResolvedValue({ key: "k", url: "/url" }),
  invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: "Document verified." } }] }),
}));

vi.mock("./db", () => mocks);
vi.mock("./storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { end: (input: string) => void } };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end: () => {
        const output = {
          prediction: "genuine",
          forgeryScore: 12,
          tamperingTypes: [],
          flaggedRegions: [],
          overlayBase64: Buffer.from("overlay").toString("base64"),
          modelVersion: "Project-trained U-Net (DocTamper FCD)",
        };
        child.stdout.emit("data", Buffer.from(JSON.stringify(output)));
        child.emit("close", 0);
      },
    };
    return child;
  },
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("open access for document verification (no sign-in required)", () => {
  it("permits history access for anonymous visitors", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    const result = await caller.analysis.history();
    expect(Array.isArray(result)).toBe(true);
    expect(mocks.listDocumentAnalyses).toHaveBeenCalledWith(undefined);
  });

  it("permits document creation for anonymous visitors using guest context", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    const result = await caller.analysis.create({
      fileName: "certificate.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
    });
    expect(mocks.getOrCreateGuestUser).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 1, prediction: "genuine" });
  });
});
