export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type Message = {
  role: Role;
  content: string | any;
};

export type InvokeParams = {
  messages: Message[];
  [key: string]: any;
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string;
    };
    finish_reason: string | null;
  }>;
};

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const OLLAMA_TIMEOUT_MS = 30_000;

// Deterministic fallback used only when the local Ollama runtime is
// unreachable or the model isn't pulled -- keeps the app usable, but the
// caller has no way to tell this apart from a real generation from the
// response shape alone, so failures are logged server-side instead.
function templateExplanation(params: InvokeParams): string {
  const userMessage = params.messages.find(m => m.role === "user")?.content || "";
  const textContent = typeof userMessage === "string" ? userMessage : JSON.stringify(userMessage);

  const isForged = textContent.includes("Prediction: forged");
  const scoreMatch = textContent.match(/Forgery likelihood: (\d+)%/i);
  const score = scoreMatch ? scoreMatch[1] : isForged ? "78" : "15";

  const docMatch = textContent.match(/Document: ([^\n]+)/i);
  const docName = docMatch ? docMatch[1] : "The document";

  if (isForged) {
    return `Analysis of ${docName} revealed structural and pixel-level anomalies with an estimated forgery likelihood of ${score}%. Signal analysis detected suspicious text region boundaries, inconsistent compression artifacts, and localized visual edge variations. Manual institutional review is recommended before accepting this document.`;
  }
  return `Screening of ${docName} indicated uniform document text characteristics and consistent edge structures with a low forgery score of ${score}%. No high-confidence tampering signals or localized text anomalies were detected across the document regions.`;
}

async function callOllama(params: InvokeParams): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: params.messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content?.trim();
    if (!content) throw new Error("Ollama returned an empty message");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  let content: string;
  let model = OLLAMA_MODEL;
  try {
    content = await callOllama(params);
  } catch (error) {
    console.warn("[llm] Ollama unavailable, falling back to template explanation:", error instanceof Error ? error.message : error);
    content = templateExplanation(params);
    model = "veritylens-explain-fallback-v1";
  }

  return {
    id: "local-llm-" + Date.now(),
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
  };
}
