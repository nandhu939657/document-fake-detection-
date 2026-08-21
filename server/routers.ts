import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createDocumentAnalysis, getDocumentAnalysisById, listDocumentAnalyses } from "./db";
import { storagePut } from "./storage";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execAnalysis = promisify((input: string, callback: (error: Error | null, result?: string) => void) => {
  const child = spawn("python3", ["scripts/infer_document.py"], { cwd: process.cwd() });
  let output = "";
  let errorOutput = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { errorOutput += chunk.toString(); });
  child.on("error", error => callback(error));
  child.on("close", code => {
    if (code !== 0) callback(new Error(errorOutput || `Inference exited with code ${code}`));
    else callback(null, output);
  });
  child.stdin.end(input);
});

const dataUrlSchema = z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,/i);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  analysis: router({
    history: protectedProcedure.query(({ ctx }) => listDocumentAnalyses(ctx.user.id)),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(({ ctx, input }) => getDocumentAnalysisById(input.id, ctx.user.id)),
    create: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(255), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), dataUrl: dataUrlSchema })).mutation(async ({ ctx, input }) => {
      const base64 = input.dataUrl.split(",")[1] ?? "";
      const originalBytes = Buffer.from(base64, "base64");
      if (originalBytes.byteLength > 8 * 1024 * 1024) throw new Error("Please upload an image smaller than 8 MB.");
      const original = await storagePut(`documents/${ctx.user.id}/${randomUUID()}-${input.fileName}`, originalBytes, input.mimeType);
      const rawResult = await execAnalysis(base64);
      const result = JSON.parse(rawResult ?? "") as {
        prediction: "genuine" | "forged";
        forgeryScore: number;
        tamperingTypes: string[];
        flaggedRegions: Array<{ x: number; y: number; width: number; height: number }>;
        overlayBase64: string;
        modelVersion: string;
        modelNote?: string;
      };
      if (!result.overlayBase64) throw new Error("The analysis model did not return an overlay.");
      const overlayBytes = Buffer.from(result.overlayBase64, "base64");
      const overlay = await storagePut(`analyses/${ctx.user.id}/${randomUUID()}-overlay.jpg`, overlayBytes, "image/jpeg");
      const llmResponse = await invokeLLM({
        messages: [
          { role: "system", content: "You write concise, cautious verification explanations for institutional document reviewers. Never claim legal certainty or official verification. Explain the model result in plain language." },
          { role: "user", content: `Document: ${input.fileName}\nPrediction: ${result.prediction}\nForgery likelihood: ${result.forgeryScore}%\nTampering types: ${result.tamperingTypes.join(", ")}\nFlagged regions as normalized coordinates: ${JSON.stringify(result.flaggedRegions)}\nModel note: ${result.modelNote ?? ""}\nWrite one readable paragraph describing what was flagged and why the model reached this result.` },
        ],
      });
      const explanation = String(llmResponse.choices?.[0]?.message?.content ?? "The model completed the analysis, but a narrative explanation was unavailable.");
      return createDocumentAnalysis({
        userId: ctx.user.id,
        fileName: input.fileName,
        mimeType: input.mimeType,
        originalKey: original.key,
        originalUrl: original.url,
        overlayKey: overlay.key,
        overlayUrl: overlay.url,
        prediction: result.prediction,
        forgeryScore: result.forgeryScore,
        tamperingTypes: JSON.stringify(result.tamperingTypes),
        flaggedRegions: JSON.stringify(result.flaggedRegions),
        explanation,
        modelVersion: result.modelVersion,
      });
    }),
  }),
});

export type AppRouter = typeof appRouter;
