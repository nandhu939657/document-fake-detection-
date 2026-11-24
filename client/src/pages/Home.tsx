import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { startLogin } from "@/const";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, FileCheck2, FileImage, History, Info, LockKeyhole, LogOut, ScanSearch, ShieldCheck, UploadCloud } from "lucide-react";
import { toast } from "sonner";

const ACCEPTED = "image/png,image/jpeg,image/webp";

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read this file."));
    reader.readAsDataURL(file);
  });
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof ScanSearch }) {
  return <Card className="border-border/70 bg-card/80 shadow-sm"><CardContent className="p-5"><div className="mb-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="size-4" /></span></div><div className="text-2xl font-semibold tracking-tight">{value}</div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function AnalysisReport({ report, onReset }: { report: any; onReset: () => void }) {
  const [showMarkup, setShowMarkup] = useState(true);
  const types = useMemo(() => JSON.parse(report.tamperingTypes || "[]") as string[], [report.tamperingTypes]);
  const regions = useMemo(() => JSON.parse(report.flaggedRegions || "[]") as Array<{ type?: "text" | "signature" | "logo" | "seal"; label?: string; confidence: number; x: number; y: number; width: number; height: number }>, [report.flaggedRegions]);
  const decision: "genuine" | "review" | "forged" = report.decision ?? (report.prediction === "forged" ? "forged" : "genuine");
  const isForged = decision === "forged";
  const isReview = decision === "review";
  const decisionLabel = isForged ? "Forgery suspected" : isReview ? "Needs human review" : "No strong forgery signal (Genuine)";
  const decisionClass = isForged ? "bg-rose-100 text-rose-700 hover:bg-rose-100 border border-rose-200" : isReview ? "bg-amber-100 text-amber-700 hover:bg-amber-100 border border-amber-200" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200";
  const dotClass = isForged ? "bg-rose-500" : isReview ? "bg-amber-500" : "bg-emerald-500";
  return <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="eyebrow">Verification report</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{report.fileName}</h2><p className="mt-1 text-sm text-muted-foreground">Analyzed with {report.modelVersion}</p>{String(report.modelVersion).toLowerCase().includes("baseline") && <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700"><AlertTriangle className="size-3.5" />No trained model loaded · visual baseline only</div>}</div><div className="flex items-center gap-3"><Badge className={cn("w-fit px-3 py-1.5 text-sm", decisionClass)}><span className={cn("mr-2 size-2 rounded-full", dotClass)} />{decisionLabel}</Badge><Button variant="outline" onClick={onReset}><UploadCloud className="mr-2 size-4" />Analyze another document</Button></div></div>
    <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><Card className="overflow-hidden border-border/70 shadow-sm"><CardHeader className="border-b border-border/60 bg-muted/20 pb-3"><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2 text-base"><FileImage className="size-4 text-primary" />Document Inspection</CardTitle><div className="flex items-center gap-1.5"><Button variant={showMarkup ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setShowMarkup(true)}>Marked Evidence</Button><Button variant={!showMarkup ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setShowMarkup(false)}>Clean Original</Button></div></div></CardHeader><CardContent className="p-4"><div className="relative overflow-hidden rounded-xl border bg-slate-100"><img src={showMarkup ? report.overlayUrl : (report.originalUrl || report.overlayUrl)} alt="Uploaded document" className="max-h-[520px] w-full object-contain" />{showMarkup && decision !== "genuine" && <div className="pointer-events-none absolute inset-0">{regions.map((region, index) => { const isCircle = region.type === "signature" || region.type === "logo" || region.type === "seal"; const borderCol = isReview ? "border-amber-500" : "border-rose-600"; const bgCol = isReview ? "bg-amber-500/10" : "bg-rose-500/10"; const badgeBg = isReview ? "bg-amber-600" : "bg-rose-600"; const typeLabel = region.type === "signature" ? "Signature" : (region.type === "logo" || region.type === "seal" ? "Seal / Logo" : "Altered Text"); return isCircle ? <div key={index} className={cn("absolute flex items-start justify-center rounded-full border-[3px] shadow-sm", borderCol, bgCol)} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><span className={cn("absolute -top-5 rounded px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm whitespace-nowrap", badgeBg)}>{typeLabel} ({Math.round(region.confidence * 100)}%)</span></div> : <div key={index} className={cn("absolute border-b-[4px] bg-rose-500/[0.04]", borderCol)} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><span className={cn("absolute -top-5 left-0 rounded px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm whitespace-nowrap", badgeBg)}>{typeLabel} ({Math.round(region.confidence * 100)}%)</span></div>; })}</div>}</div><div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="h-1 w-4 rounded bg-rose-600" /> Red underline = Altered text</span><span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-rose-600" /> Circle = Suspect signature / seal</span><span className="ml-auto text-[11px] font-medium">{decision === "genuine" ? "No tampering detected" : `${regions.length} suspicious region${regions.length === 1 ? "" : "s"}`}</span></div></CardContent></Card>
      <div className="space-y-5"><Card className="border-border/70 shadow-sm"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-sm font-medium">Forgery likelihood</span><span className={cn("text-2xl font-semibold", isForged ? "text-rose-600" : isReview ? "text-amber-600" : "text-emerald-600")}>{report.forgeryScore}%</span></div><Progress value={report.forgeryScore} className="mt-4 h-2.5" /><p className="mt-3 text-xs leading-relaxed text-muted-foreground">Bands: 0-34 no strong signal, 35-69 needs human review, 70-99 forgery suspected. This is a model signal, not official verification against an issuing authority.</p></CardContent></Card><Card className="border-border/70 shadow-sm"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className={cn("size-4", isForged ? "text-rose-600" : isReview ? "text-amber-600" : "text-emerald-600")} />Detected indicators</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2 pt-0">{types.map(type => <Badge key={type} variant="secondary" className={cn("rounded-full px-3 py-1 font-normal capitalize", type.includes("signature") ? "border-purple-200 bg-purple-50 text-purple-700" : type.includes("seal") || type.includes("logo") ? "border-blue-200 bg-blue-50 text-blue-700" : type.includes("text") ? "border-rose-200 bg-rose-50 text-rose-700" : "")}>{type}</Badge>)}</CardContent></Card><Card className="border-primary/15 bg-primary/[0.035] shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Info className="size-4 text-primary" />Plain-language explanation</CardTitle></CardHeader><CardContent className="pt-0"><p className="text-sm leading-7 text-foreground/80">{report.explanation}</p></CardContent></Card><Card className="border-border/70 bg-white shadow-sm"><CardContent className="grid gap-4 p-5 text-xs sm:grid-cols-2"><div><div className="font-medium text-foreground">Model provenance</div><div className="mt-1 leading-5 text-muted-foreground">{report.modelVersion}</div></div><div><div className="font-medium text-foreground">Evaluation status</div><div className="mt-1 leading-5 text-muted-foreground">A U-Net trained on pixel-level document tampering annotations produces the mask. Scores in the review band require a human decision; the model is not validated for any specific issuing authority.</div></div></CardContent></Card></div></div>
  </div>;
}

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("analyze");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [report, setReport] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const analysis = trpc.analysis.create.useMutation({
    onSuccess: data => {
      setReport(data);
      setSelectedFile(null);
      utils.analysis.history.invalidate();
      toast.success("Document analysis complete");
    },
    onError: error => toast.error(error.message || "Analysis failed"),
  });
  const history = trpc.analysis.history.useQuery();

  const selectFile = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast.error("Please choose a PNG, JPG, or WEBP image.");
    if (file.size > 8 * 1024 * 1024) return toast.error("Please choose an image smaller than 8 MB.");
    setSelectedFile(file);
    setReport(null);
  };
  const analyze = async () => {
    if (!selectedFile) return;
    try {
      const dataUrl = await readAsDataUrl(selectedFile);
      analysis.mutate({
        fileName: selectedFile.name,
        mimeType: selectedFile.type as "image/png" | "image/jpeg" | "image/webp",
        dataUrl,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to read the file.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f9fc] text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="brand-mark">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">
                Verity<span className="text-primary">Lens</span>
              </div>
              <div className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
                Document intelligence
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <div className="hidden text-right sm:block">
                  <div className="text-xs font-medium">{user?.name || "Reviewer"}</div>
                  <div className="text-[11px] text-muted-foreground">Active session</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => logout()} aria-label="Sign out">
                  <LogOut className="size-4" />
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-sm">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Instant Testing Mode</span>
                <span className="hidden text-[11px] text-emerald-600 sm:inline">· No login required</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-8 lg:px-10 lg:py-10">
        <div className="mb-9 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="eyebrow">Institutional verification workspace</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.04em] text-slate-900 md:text-5xl">
              See the evidence behind every document decision.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
              A transparent, explainable screening layer for certificates and sensitive documents. Upload an image to inspect visual anomalies, review highlighted tampering, and understand the model’s reasoning.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            <span className="size-2 rounded-full bg-emerald-500" /> Analysis engine online
          </div>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-3">
          <StatCard label="Analysis mode" value="Visual XAI" detail="CNN-compatible inference adapter" icon={ScanSearch} />
          <StatCard label="Evidence view" value="U-Net mask" detail="Tampered-text regions overlaid on source image" icon={FileCheck2} />
          <StatCard label="Access control" value="Instant Access" detail="No login required · Ready for full testing" icon={ShieldCheck} />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-7 bg-slate-200/70 p-1">
            <TabsTrigger value="analyze" className="gap-2">
              <ScanSearch className="size-4" />Analyze document
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="size-4" />Analysis history
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analyze" className="mt-0">
            {report ? (
              <AnalysisReport
                report={report}
                onReset={() => {
                  setReport(null);
                  setSelectedFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
                <Card className="border-border/70 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-xl">Upload a document image</CardTitle>
                    <p className="text-sm leading-6 text-muted-foreground">Supported formats: PNG, JPG, and WEBP. Maximum file size is 8 MB.</p>
                  </CardHeader>
                  <CardContent>
                    <div
                      onDragOver={event => {
                        event.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={event => {
                        event.preventDefault();
                        setIsDragging(false);
                        selectFile(event.dataTransfer.files[0]);
                      }}
                      onClick={() => fileRef.current?.click()}
                      className={cn(
                        "group cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all md:p-14",
                        isDragging ? "border-primary bg-primary/5" : "border-slate-300 bg-slate-50/70 hover:border-primary/60 hover:bg-primary/[0.025]"
                      )}
                    >
                      <input
                        ref={fileRef}
                        type="file"
                        accept={ACCEPTED}
                        className="hidden"
                        onChange={event => selectFile(event.target.files?.[0])}
                      />
                      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-primary shadow-sm ring-1 ring-slate-200 transition-transform group-hover:-translate-y-1">
                        <UploadCloud className="size-7" />
                      </div>
                      <h3 className="mt-5 font-semibold">Drop your document here</h3>
                      <p className="mt-2 text-sm text-muted-foreground">or click to browse from your device</p>
                      {selectedFile && (
                        <div className="mx-auto mt-5 flex max-w-sm items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm">
                          <FileImage className="size-5 text-primary" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{selectedFile.name}</div>
                            <div className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB ready for analysis</div>
                          </div>
                          <CheckCircle2 className="ml-auto size-4 shrink-0 text-emerald-500" />
                        </div>
                      )}
                    </div>

                    <Button
                      className="mt-5 w-full"
                      size="lg"
                      disabled={!selectedFile || analysis.isPending}
                      onClick={event => {
                        event.stopPropagation();
                        analyze();
                      }}
                    >
                      {analysis.isPending ? "Running secure analysis…" : "Analyze document"}
                      <ArrowUpRight className="ml-2 size-4" />
                    </Button>
                    {analysis.isPending && (
                      <p className="mt-3 text-center text-xs text-muted-foreground">
                        Generating heatmap and plain-language explanation. This may take a moment.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-slate-900 text-white shadow-sm">
                  <CardContent className="flex h-full flex-col justify-between p-7">
                    <div>
                      <p className="eyebrow text-slate-400">How it works</p>
                      <h2 className="mt-3 text-2xl font-semibold leading-tight">Evidence first. Decisions second.</h2>
                      <p className="mt-4 text-sm leading-7 text-slate-300">
                        VerityLens combines server-side visual inference with an explainability layer so reviewers can see both the result and the image evidence behind it.
                      </p>
                    </div>
                    <div className="mt-10 space-y-4">
                      {[
                        ["01", "Visual inspection", "The analyzer scans the document for inconsistent image patterns."],
                        ["02", "Region highlighting", "A segmentation model marks regions associated with tampered text or forged seals."],
                        ["03", "Readable report", "An AI-generated explanation translates the findings for non-technical reviewers."],
                      ].map(([number, title, text]) => (
                        <div key={number} className="flex gap-4 border-t border-white/10 pt-4">
                          <span className="font-mono text-xs text-primary">{number}</span>
                          <div>
                            <div className="text-sm font-medium">{title}</div>
                            <div className="mt-1 text-xs leading-5 text-slate-400">{text}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <div className="space-y-3">
              {history.isLoading ? (
                <div className="rounded-xl border bg-white p-10 text-center text-sm text-muted-foreground">
                  Loading analysis history…
                </div>
              ) : history.data?.length ? (
                history.data.map(item => {
                  const decision = item.decision ?? (item.prediction === "forged" ? "forged" : "genuine");
                  const tone = decision === "forged" ? "bg-rose-50 text-rose-600" : decision === "review" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600";
                  const textTone = decision === "forged" ? "text-rose-600" : decision === "review" ? "text-amber-600" : "text-emerald-600";
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setReport(item);
                        setActiveTab("analyze");
                      }}
                      className="flex w-full items-center gap-4 rounded-xl border border-border/70 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className={cn("rounded-xl p-3", tone)}>
                        <FileCheck2 className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{item.fileName}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock3 className="size-3.5" />
                          {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="hidden text-right sm:block">
                        <div className={cn("text-sm font-semibold", textTone)}>{item.forgeryScore}% likelihood</div>
                        <div className="mt-1 text-xs capitalize text-muted-foreground">{decision}</div>
                      </div>
                      <ArrowUpRight className="size-4 text-muted-foreground" />
                    </button>
                  );
                })
              ) : (
                <Card className="border-border/70 shadow-sm">
                  <CardContent className="flex flex-col items-center py-16 text-center">
                    <History className="size-8 text-muted-foreground" />
                    <h2 className="mt-4 text-xl font-semibold">No analyses yet</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Your completed verification reports will appear here.</p>
                    <Button className="mt-6" onClick={() => setActiveTab("analyze")}>
                      Analyze a document
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mx-auto flex max-w-[1440px] items-center justify-between border-t border-border/60 px-5 py-6 text-xs text-muted-foreground lg:px-10">
        <span>VerityLens · Explainable document intelligence</span>
        <span>Visual screening only · Not official verification</span>
      </footer>
    </div>
  );
}
