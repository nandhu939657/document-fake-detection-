import { existsSync } from "node:fs";
import { join } from "node:path";

const VENV_PYTHON = process.platform === "win32"
  ? join("models", "ml", ".venv", "Scripts", "python.exe")
  : join("models", "ml", ".venv", "bin", "python");

export function resolvePythonCommand(): string {
  if (existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}
