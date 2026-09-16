import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AiProvider, DeploymentPlan } from "@deploythisshit/shared";
import { run } from "./process.js";

const deniedNames = new Set([".git", "node_modules", "dist", ".next", ".turbo", ".cache"]);
const deniedPatterns = [/^\.env(?:\.|$)/, /(?:^|\.)pem$/i, /(?:^|\.)key$/i, /^id_(?:rsa|ed25519)/i, /credentials/i];

export function deterministicPlan(cwd: string): DeploymentPlan {
  if (existsSync(join(cwd, "package.json"))) {
    const hasLock = existsSync(join(cwd, "package-lock.json"));
    return {
      dockerfile: `FROM node:22-bookworm-slim AS deps\nWORKDIR /app\nCOPY package*.json ./\nRUN ${hasLock ? "npm ci" : "npm install"}\n\nFROM node:22-bookworm-slim\nENV NODE_ENV=production\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN npm run build --if-present\nEXPOSE 3000\nCMD ["npm", "start"]\n`,
      dockerignore: "node_modules\ndist\n.git\n.env*\n*.log\n.deploythisshit*\n",
      containerPort: 3000,
      healthPath: "/",
      summary: "Detected a Node.js application and prepared a production npm image.",
      warnings: ["Confirm that npm start binds to 0.0.0.0 and uses PORT=3000."]
    };
  }
  if (existsSync(join(cwd, "requirements.txt")) || existsSync(join(cwd, "pyproject.toml"))) {
    return {
      dockerfile: "FROM python:3.13-slim\nWORKDIR /app\nCOPY . .\nRUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi\nEXPOSE 8000\nCMD [\"python\", \"-m\", \"http.server\", \"8000\", \"--bind\", \"0.0.0.0\"]\n",
      dockerignore: ".git\n.env*\n__pycache__\n*.pyc\n.venv\n.deploythisshit*\n",
      containerPort: 8000,
      healthPath: "/",
      summary: "Detected a Python project and prepared a conservative Python image.",
      warnings: ["Replace the fallback command with your production ASGI or WSGI server if needed."]
    };
  }
  return {
    dockerfile: "FROM nginx:1.27-alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\n",
    dockerignore: ".git\n.env*\nnode_modules\n.deploythisshit*\n",
    containerPort: 80,
    healthPath: "/",
    summary: "Prepared a static Nginx image because no application manifest was detected.",
    warnings: ["Confirm this project contains static files intended for the web root."]
  };
}

function validatePlan(value: unknown): DeploymentPlan {
  const plan = value as Partial<DeploymentPlan>;
  if (
    typeof plan.dockerfile !== "string" ||
    typeof plan.dockerignore !== "string" ||
    !Number.isInteger(plan.containerPort) ||
    Number(plan.containerPort) < 1 ||
    Number(plan.containerPort) > 65_535 ||
    typeof plan.healthPath !== "string" ||
    !plan.healthPath.startsWith("/") ||
    typeof plan.summary !== "string" ||
    !Array.isArray(plan.warnings)
  ) {
    throw new Error("The AI returned an invalid deployment plan.");
  }
  if (/\b(?:--privileged|host network|docker\.sock)\b/i.test(plan.dockerfile)) {
    throw new Error("The AI plan requested unsafe host privileges.");
  }
  return plan as DeploymentPlan;
}

async function snapshotProject(cwd: string): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), "deploythisshit-ai-"));
  await cp(cwd, destination, {
    recursive: true,
    filter(source) {
      const name = basename(source);
      if (source === cwd) return true;
      return !deniedNames.has(name) && !deniedPatterns.some((pattern) => pattern.test(name));
    }
  });
  return destination;
}

const prompt = `Inspect this sanitized project snapshot and produce a safe Docker deployment plan. Return only the requested JSON shape. The container must run as an unprivileged process when practical, bind its HTTP service to 0.0.0.0, declare the detected port, use deterministic dependency installation, and never copy .env files, private keys, Git history, or cloud credentials. Do not request host networking, privileged mode, Docker socket access, or secrets. Prefer multi-stage builds where they materially reduce the image. The healthPath must be an HTTP path. Include clear warnings for assumptions.`;

async function codexPlan(snapshot: string): Promise<DeploymentPlan> {
  const schemaPath = join(snapshot, ".dts-plan-schema.json");
  const outputPath = join(snapshot, ".dts-plan.json");
  await writeFile(schemaPath, JSON.stringify({
    type: "object",
    properties: {
      dockerfile: { type: "string" },
      dockerignore: { type: "string" },
      containerPort: { type: "integer", minimum: 1, maximum: 65535 },
      healthPath: { type: "string" },
      summary: { type: "string" },
      warnings: { type: "array", items: { type: "string" } }
    },
    required: ["dockerfile", "dockerignore", "containerPort", "healthPath", "summary", "warnings"],
    additionalProperties: false
  }));
  await run("codex", [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    prompt
  ], { cwd: snapshot, capture: true });
  return validatePlan(JSON.parse(await readFile(outputPath, "utf8")));
}

async function claudePlan(snapshot: string): Promise<DeploymentPlan> {
  const output = await run("claude", [
    "-p",
    "--output-format",
    "json",
    "--allowedTools",
    "Read,Glob,Grep",
    `${prompt}\nReturn JSON with keys dockerfile, dockerignore, containerPort, healthPath, summary, and warnings.`
  ], { cwd: snapshot, capture: true });
  const wrapper = JSON.parse(output) as { result?: string } | DeploymentPlan;
  const value = "result" in wrapper && typeof wrapper.result === "string" ? JSON.parse(wrapper.result) : wrapper;
  return validatePlan(value);
}

export async function createDeploymentPlan(provider: AiProvider, cwd: string): Promise<DeploymentPlan> {
  if (provider === "none") return deterministicPlan(cwd);
  const snapshot = await snapshotProject(cwd);
  try {
    return provider === "codex" ? await codexPlan(snapshot) : await claudePlan(snapshot);
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

