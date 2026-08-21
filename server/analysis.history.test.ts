import { beforeEach, describe, expect, it, vi } from "vitest";

const { listDocumentAnalyses } = vi.hoisted(() => ({ listDocumentAnalyses: vi.fn() }));
vi.mock("./db", () => ({
  listDocumentAnalyses,
  createDocumentAnalysis: vi.fn(),
  getDocumentAnalysisById: vi.fn(),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function authenticatedContext(): TrpcContext {
  return {
    user: { id: 42, openId: "reviewer", name: "Reviewer", email: "reviewer@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("analysis.history", () => {
  beforeEach(() => listDocumentAnalyses.mockReset());

  it("returns only the authenticated reviewer's saved analyses", async () => {
    listDocumentAnalyses.mockResolvedValue([{ id: 7, userId: 42, fileName: "degree-certificate.png", prediction: "forged", forgeryScore: 84 }]);
    const caller = appRouter.createCaller(authenticatedContext());
    const result = await caller.analysis.history();
    expect(listDocumentAnalyses).toHaveBeenCalledWith(42);
    expect(result[0]).toMatchObject({ fileName: "degree-certificate.png", forgeryScore: 84 });
  });
});
