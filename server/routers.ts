import { z } from "zod";
import { COOKIE_NAME, decisionForScore, type AnalysisDecision } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createDocumentAnalysis, getDocumentAnalysisById, listDocumentAnalyses } from "./db";
import { storagePut } from "./storage";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { resolvePythonCommand } from "./pythonRuntime";

const ANALYSIS_TIMEOUT_MS = 120_000;

const execAnalysis = promisify((input: string, callback: (error: Error | null, result?: string) => void) => {
  const child = spawn(resolvePythonCommand(), ["scripts/infer_document.py"], { cwd: process.cwd() });
  let output = "";
  let errorOutput = "";
  const timer = setTimeout(() => {
    child.kill();
    callback(new Error(`Inference timed out after ${ANALYSIS_TIMEOUT_MS / 1000}s.`));
  }, ANALYSIS_TIMEOUT_MS);
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { errorOutput += chunk.toString(); });
  child.on("error", error => { clearTimeout(timer); callback(error); });
  child.on("close", code => {
    clearTimeout(timer);
    if (code !== 0) callback(new Error(errorOutput || `Inference exited with code ${code}`));
    else callback(null, output);
  });
  child.stdin.end(input);
});

const toStoragePath = (url?: string) => {
  if (!url) return url;
  const marker = "/veritylens/";
  const index = url.indexOf(marker);
  return index === -1 ? url : `/manus-storage/${url.slice(index + marker.length).split("?")[0]}`;
};

const withDecision = <T extends { forgeryScore: number; originalUrl?: string; overlayUrl?: string }>(row: T) => ({
  ...row,
  originalUrl: toStoragePath(row.originalUrl),
  overlayUrl: toStoragePath(row.overlayUrl),
  decision: decisionForScore(row.forgeryScore),
});

const dataUrlSchema = z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,/i);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    devLogin: publicProcedure
      .input(z.object({ email: z.string().email(), name: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ENV.isProduction && process.env.ALLOW_DEV_LOGIN !== "true") {
          throw new Error("Local sign-in is disabled in production. Configure OAuth or Supabase Auth to enable sign-in.");
        }
        const openId = `user_${input.email.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const name = input.name || input.email.split("@")[0];
        const { upsertUser, getUserByOpenId } = await import("./db");
        const { sdk } = await import("./_core/sdk");
        
        await upsertUser({
          openId,
          name,
          email: input.email,
          loginMethod: "local",
          lastSignedIn: new Date(),
        });
        
        const token = await sdk.createSessionToken(openId, { name });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        
        const user = await getUserByOpenId(openId);
        return { user, token };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  analysis: router({
    history: protectedProcedure.query(async ({ ctx }) => (await listDocumentAnalyses(ctx.user.id)).map(withDecision)),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const row = await getDocumentAnalysisById(input.id, ctx.user.id);
      return row ? withDecision(row) : row;
    }),
    create: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(255), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), dataUrl: dataUrlSchema })).mutation(async ({ ctx, input }) => {
      const base64 = input.dataUrl.split(",")[1] ?? "";
      const originalBytes = Buffer.from(base64, "base64");
      if (originalBytes.byteLength > 8 * 1024 * 1024) throw new Error("Please upload an image smaller than 8 MB.");
      const original = await storagePut(`documents/${ctx.user.id}/${randomUUID()}-${input.fileName}`, originalBytes, input.mimeType);
      const rawResult = await execAnalysis(base64);
      const result = JSON.parse(rawResult ?? "") as {
        prediction?: "genuine" | "forged";
        decision?: AnalysisDecision;
        forgeryScore: number;
        tamperingTypes: string[];
        flaggedRegions: Array<{ x: number; y: number; width: number; height: number }>;
        overlayBase64: string;
        modelVersion: string;
        modelNote?: string;
      };
      if (!result.overlayBase64) throw new Error("The analysis model did not return an overlay.");
      const decision = result.decision ?? decisionForScore(result.forgeryScore);
      const overlayBytes = Buffer.from(result.overlayBase64, "base64");
      const overlay = await storagePut(`analyses/${ctx.user.id}/${randomUUID()}-overlay.jpg`, overlayBytes, "image/jpeg");
      const safeFileName = input.fileName.replace(/[\r\n]+/g, " ").slice(0, 255);
      const llmResponse = await invokeLLM({
        messages: [
          { role: "system", content: "You write concise, cautious verification explanations for institutional document reviewers. Never claim legal certainty or official verification. Explain the model result in plain language. If the decision is review, state clearly that a human reviewer must decide." },
          { role: "user", content: `Document: ${safeFileName}\nDecision: ${decision}\nForgery likelihood: ${result.forgeryScore}%\nTampering types: ${result.tamperingTypes.join(", ")}\nFlagged regions as normalized coordinates: ${JSON.stringify(result.flaggedRegions)}\nModel note: ${result.modelNote ?? ""}\nWrite one readable paragraph describing what was flagged and why the model reached this result.` },
        ],
      });
      const explanation = String(llmResponse.choices?.[0]?.message?.content ?? "The model completed the analysis, but a narrative explanation was unavailable.");
      const row = await createDocumentAnalysis({
        userId: ctx.user.id,
        fileName: input.fileName,
        mimeType: input.mimeType,
        originalKey: original.key,
        originalUrl: original.url,
        overlayKey: overlay.key,
        overlayUrl: overlay.url,
        prediction: decision === "genuine" ? "genuine" : "forged",
        forgeryScore: result.forgeryScore,
        tamperingTypes: JSON.stringify(result.tamperingTypes),
        flaggedRegions: JSON.stringify(result.flaggedRegions),
        explanation,
        modelVersion: result.modelVersion,
      });
      return withDecision(row);
    }),
  }),
});

export type AppRouter = typeof appRouter;
