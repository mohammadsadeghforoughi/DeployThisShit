#!/usr/bin/env node
import { hostname } from "node:os";
import { basename } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { AiProvider, AppRecord, DeploymentPlan, DeploymentStatus } from "@deploythisshit/shared";
import { isValidHostname, slugify } from "@deploythisshit/shared";
import { ApiClient } from "./api.js";
import { createDeploymentPlan, deterministicPlan } from "./ai.js";
import {
  loadCliConfig,
  loadProjectConfig,
  saveCliConfig,
  saveProjectConfig,
  type ProjectConfig
} from "./config.js";
import { buildImage } from "./docker.js";
import { run } from "./process.js";
import { ask, ui } from "./terminal.js";

interface Arguments {
  command: string;
  flags: Map<string, string | true>;
}

function parseArguments(argv: string[]): Arguments {
  const command = argv[0]?.startsWith("-") ? "deploy" : argv[0] || "deploy";
  const rest = argv[0]?.startsWith("-") ? argv : argv.slice(1);
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]!;
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    if (!key) continue;
    if (inline !== undefined) flags.set(key, inline);
    else if (rest[index + 1] && !rest[index + 1]!.startsWith("--")) flags.set(key, rest[++index]!);
    else flags.set(key, true);
  }
  return { command, flags };
}

function flag(args: Arguments, key: string): string | undefined {
  const value = args.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function provider(value: string): AiProvider {
  if (value !== "codex" && value !== "claude" && value !== "none") {
    throw new Error("AI provider must be codex, claude, or none.");
  }
  return value;
}

async function init(args: Arguments): Promise<void> {
  ui.title("DeployThisShit / pair this machine");
  const serverUrl = (flag(args, "server") || await ask("Server URL", "http://127.0.0.1:8787")).replace(/\/$/, "");
  const aiProvider = provider(flag(args, "ai") || await ask("Local AI provider (codex, claude, none)", "codex"));
  const deviceName = flag(args, "device") || await ask("Device name", hostname());
  const publicClient = new ApiClient(serverUrl, null);
  await publicClient.health();
  const pairing = await publicClient.startPairing(deviceName);

  ui.info(`Pairing code: ${pairing.code}`);
  ui.info(`Approve in the dashboard: ${pairing.approvalUrl}`);

  const developmentAdminToken = flag(args, "admin-token");
  if (developmentAdminToken) {
    await new ApiClient(serverUrl, developmentAdminToken).approvePairing(pairing.pairingId);
    ui.warn("Pairing was auto-approved with --admin-token. Use dashboard approval outside local development.");
  }

  const expiresAt = Date.parse(pairing.expiresAt);
  while (Date.now() < expiresAt) {
    const result = await publicClient.pollPairing(pairing.pairingId, pairing.pollSecret);
    if (result.status === "approved" && result.token) {
      await saveCliConfig({ serverUrl, token: result.token, aiProvider, deviceName });
      ui.success(`Paired ${deviceName} with ${serverUrl}`);
      ui.info(`AI adapter: ${aiProvider}. DeployThisShit will use its existing local login.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Pairing request expired before it was approved.");
}

async function projectName(cwd: string): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile(`${cwd}/package.json`, "utf8")) as { name?: string };
    if (packageJson.name) return packageJson.name.replace(/^@[^/]+\//, "");
  } catch {
    // Fall back to the directory name.
  }
  return basename(cwd);
}

async function ensurePlan(aiProvider: AiProvider, cwd: string): Promise<DeploymentPlan> {
  if (existsSync(`${cwd}/Dockerfile`)) {
    const plan = deterministicPlan(cwd);
    ui.info("Using the existing Dockerfile.");
    return plan;
  }
  ui.info(aiProvider === "none" ? "Detecting a safe Docker template" : `Asking local ${aiProvider} to prepare the container plan`);
  const plan = await createDeploymentPlan(aiProvider, cwd);
  await writeFile(`${cwd}/Dockerfile`, plan.dockerfile, { flag: "wx" });
  if (!existsSync(`${cwd}/.dockerignore`)) await writeFile(`${cwd}/.dockerignore`, plan.dockerignore, { flag: "wx" });
  ui.success(plan.summary);
  for (const warning of plan.warnings) ui.warn(warning);
  return plan;
}

async function resolveProject(
  args: Arguments,
  api: ApiClient,
  plan: DeploymentPlan,
  cwd: string
): Promise<ProjectConfig> {
  const existing = await loadProjectConfig(cwd);
  if (existing) return existing;
  const suggestedName = await projectName(cwd);
  const name = flag(args, "name") || await ask("Application name", suggestedName);
  const slug = slugify(flag(args, "slug") || name);
  const domain = flag(args, "domain") || await ask("Public domain");
  if (!isValidHostname(domain)) throw new Error("Public domain is not a valid hostname.");
  const port = Number.parseInt(flag(args, "port") || String(plan.containerPort), 10);
  const healthPath = flag(args, "health-path") || plan.healthPath;
  const apps = await api.listApps();
  const matched = apps.find((app) => app.slug === slug);
  const app = matched || await api.createApp({ name, slug, domain, containerPort: port, healthPath });
  const config = { appId: app.id, name, slug, domain, containerPort: port, healthPath };
  await saveProjectConfig(config, cwd);
  return config;
}

const terminalStatuses = new Set<DeploymentStatus>(["live", "failed"]);

async function deploy(args: Arguments): Promise<void> {
  const cwd = process.cwd();
  const config = await loadCliConfig();
  const api = new ApiClient(config.serverUrl, config.token);
  const capabilities = await api.capabilities();

  ui.title("DeployThisShit / ship what works");
  const plan = await ensurePlan(config.aiProvider, cwd);
  const project = await resolveProject(args, api, plan, cwd);
  ui.info(`Building ${project.slug} for ${capabilities.architecture}`);
  const image = await buildImage(cwd, project.slug, capabilities.architecture);
  try {
    ui.success(`Built ${image.imageTag}`);
    const { upload, chunkSizeBytes } = await api.createUpload({
      appId: project.appId,
      imageTag: image.imageTag,
      size: image.size,
      sha256: image.sha256
    });
    let lastPercent = -1;
    await api.uploadFile(upload, image.archivePath, chunkSizeBytes, (sent) => {
      const percent = Math.floor((sent / image.size) * 100);
      if (percent !== lastPercent && (percent % 10 === 0 || percent === 100)) {
        ui.info(`Uploading image: ${percent}%`);
        lastPercent = percent;
      }
    });
    ui.success(`Uploaded ${(image.size / 1024 / 1024).toFixed(1)} MB and verified the transfer`);
    let deployment = await api.finalizeUpload(upload.id);
    let previousStatus = deployment.status;
    ui.info(deployment.message);
    while (!terminalStatuses.has(deployment.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      deployment = await api.deployment(deployment.id);
      if (deployment.status !== previousStatus) {
        ui.info(deployment.message);
        previousStatus = deployment.status;
      }
    }
    if (deployment.status === "failed") throw new Error(`Deployment failed: ${deployment.message}`);
    ui.success(`Live: https://${project.domain}`);
    ui.info(`Release ${deployment.release} · deployment ${deployment.id}`);
  } finally {
    await image.cleanup();
  }
}

async function apps(): Promise<void> {
  const config = await loadCliConfig();
  const list = await new ApiClient(config.serverUrl, config.token).listApps();
  ui.title("DeployThisShit / applications");
  if (list.length === 0) {
    ui.info("No applications yet. Run DeployThisShit in a project directory.");
    return;
  }
  for (const app of list) {
    process.stdout.write(`${app.status.padEnd(10)} ${app.slug.padEnd(24)} https://${app.domain}\n`);
  }
}

async function doctor(): Promise<void> {
  ui.title("DeployThisShit / doctor");
  const config = await loadCliConfig();
  await new ApiClient(config.serverUrl, config.token).capabilities();
  ui.success(`Server reachable at ${config.serverUrl}`);
  await run("docker", ["version", "--format", "{{.Server.Version}}"], { capture: true });
  ui.success("Docker is available");
  if (config.aiProvider !== "none") {
    await run(config.aiProvider, ["--version"], { capture: true });
    ui.success(`${config.aiProvider} CLI is available; its credentials remain local`);
  }
}

function help(): void {
  process.stdout.write(`
DeployThisShit — ship a local project to your own server

Usage:
  deploythisshit init --server https://deploy.example.com
  deploythisshit deploy --domain app.example.com
  DeployThisShit
  dts apps
  dts doctor

Commands:
  init       Pair this machine and choose a local AI adapter
  deploy     Build, upload, activate, and print the public URL (default)
  apps       List applications on the paired server
  doctor     Check the server, Docker, and selected AI CLI
`);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.flags.has("help") || args.command === "help") return help();
  if (args.command === "init") return init(args);
  if (args.command === "apps") return apps();
  if (args.command === "doctor") return doctor();
  if (args.command === "deploy") return deploy(args);
  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  ui.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
