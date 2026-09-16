import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AiProvider } from "@deploythisshit/shared";

export interface CliConfig {
  serverUrl: string;
  token: string;
  aiProvider: AiProvider;
  deviceName: string;
}

export interface ProjectConfig {
  appId: string;
  name: string;
  slug: string;
  domain: string;
  containerPort: number;
  healthPath: string;
}

function globalPath(): string {
  const root = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "deploythisshit", "config.json");
}

export async function saveCliConfig(config: CliConfig): Promise<void> {
  const path = globalPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function loadCliConfig(): Promise<CliConfig> {
  if (process.env.DTS_SERVER_URL && process.env.DTS_TOKEN) {
    return {
      serverUrl: process.env.DTS_SERVER_URL.replace(/\/$/, ""),
      token: process.env.DTS_TOKEN,
      aiProvider: (process.env.DTS_AI_PROVIDER as AiProvider | undefined) || "none",
      deviceName: "Environment"
    };
  }
  try {
    return JSON.parse(await readFile(globalPath(), "utf8")) as CliConfig;
  } catch {
    throw new Error("DeployThisShit is not initialized. Run: npx deploythisshit init");
  }
}

export function projectConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, ".deploythisshit.json");
}

export async function loadProjectConfig(cwd = process.cwd()): Promise<ProjectConfig | null> {
  try {
    return JSON.parse(await readFile(projectConfigPath(cwd), "utf8")) as ProjectConfig;
  } catch {
    return null;
  }
}

export async function saveProjectConfig(config: ProjectConfig, cwd = process.cwd()): Promise<void> {
  await writeFile(projectConfigPath(cwd), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

