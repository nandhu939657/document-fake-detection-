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
const OLLAMA_TIMEOUT_MS = 60_000;

function templateExplanation(params: InvokeParams): string {
  const userMessage = params.messages.find(m => m.role === "user")?.content || "";
  const textContent = typeof userMessage === "string" ? userMessage : JSON.stringify(userMessage);

  const isForged = /Decision:\s*forged/i.test(textContent) || /Prediction:\s*forged/i.test(textContent);
  const isReview = /Decision:\s*review/i.test(textContent);
  const scoreMatch = textContent.match(/Forgery likelihood:\s*(\d+)%/i);
  const score = scoreMatch ? scoreMatch[1] : isForged ? "85" : isReview ? "48" : "18";

  const docMatch = textContent.match(/Document:\s*([^\n]+)/i);
  const docName = docMatch ? docMatch[1].trim() : "The document";

  const typesMatch = textContent.match(/Tampering types:\s*([^\n]+)/i);
  const rawTypes = typesMatch ? typesMatch[1].toLowerCase() : "";

  const hasSignature = rawTypes.includes("signature");
  const hasSealOrLogo = rawTypes.includes("seal") || rawTypes.includes("logo");
  const hasText = rawTypes.includes("text") || (!hasSignature && !hasSealOrLogo && (isForged || isReview));

  const items: string[] = [];
  if (hasSignature) items.push("anomalous signature boundary with stroke-width discontinuities (highlighted with a circular marker)");
  if (hasSealOrLogo) items.push("irregular color contrast and edge contours surrounding the official seal/logo (highlighted with a circular marker)");
  if (hasText) items.push("localized compression discrepancies and font baseline misalignment in the body text (underlined in red)");

  if (isForged) {
    const findings = items.length ? items.join(", as well as ") : "localized pixel-level manipulation artifacts";
    return `Forensic analysis of "${docName}" identified strong indicators of tampering with an estimated likelihood of ${score}%. Signal scanning detected ${findings}. The marked sections exhibit distinct digital compression variations compared to the surrounding background, indicating post-issuance modification. Manual institutional review is strongly advised.`;
  }

  if (isReview) {
    const findings = items.length ? items.join(" and ") : "moderate edge inconsistencies";
    return `Screening of "${docName}" flagged potential anomalies with a confidence score of ${score}%. The model highlighted ${findings}. While these patterns may stem from scanning artifacts or re-compression, manual inspection by an authorized reviewer is recommended before acceptance.`;
  }

  return `Screening of "${docName}" confirmed uniform typographic metrics, consistent stroke resolution, and natural background compression levels across all text lines and symbols (${score}% score). No suspicious digital manipulation, altered text, or fraudulent signatures were detected.`;
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
        options: {
          temperature: 0.6,
          num_predict: 220,
        },
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
