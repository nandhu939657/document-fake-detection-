import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("analysis authentication boundary", () => {
  it("rejects history access for anonymous visitors", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.analysis.history()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects document creation for anonymous visitors", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.analysis.create({
      fileName: "certificate.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
