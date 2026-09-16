import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const interactive = stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, value: string) => (interactive ? `\u001b[${code}m${value}\u001b[0m` : value);

export const ui = {
  title(value: string): void {
    stdout.write(`\n${paint(1, value)}\n`);
  },
  info(value: string): void {
    stdout.write(`${paint(36, "→")} ${value}\n`);
  },
  success(value: string): void {
    stdout.write(`${paint(32, "✓")} ${value}\n`);
  },
  warn(value: string): void {
    stdout.write(`${paint(33, "!")} ${value}\n`);
  },
  error(value: string): void {
    process.stderr.write(`${paint(31, "×")} ${value}\n`);
  },
  muted(value: string): string {
    return paint(2, value);
  }
};

export async function ask(question: string, fallback?: string): Promise<string> {
  if (!stdin.isTTY) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Cannot prompt for “${question}” in a non-interactive terminal.`);
  }
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = fallback ? ` ${ui.muted(`[${fallback}]`)}` : "";
    const answer = (await reader.question(`${question}${suffix}: `)).trim();
    return answer || fallback || "";
  } finally {
    reader.close();
  }
}

