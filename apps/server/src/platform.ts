import { execFile as execFileCallback, spawn } from "node:child_process";
import { hostname, loadavg, freemem, platform, totalmem, uptime } from "node:os";
import { chmod, mkdir, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppRecord, DeploymentRecord, ServerHealth } from "@deploythisshit/shared";
import type { ServerConfig } from "./config.js";

const execFile = promisify(execFileCallback);

export interface Candidate {
  containerName: string;
  hostPort: number;
}

export interface PlatformDriver {
  prepareCandidate(
    app: AppRecord,
    deployment: DeploymentRecord,
    artifactPath: string,
    hostPort: number
  ): Promise<Candidate>;
  waitUntilHealthy(app: AppRecord, candidate: Candidate): Promise<void>;
  route(app: AppRecord, candidate: Candidate): Promise<void>;
  stopContainer(name: string): Promise<void>;
  startContainer(name: string): Promise<void>;
  setBasicAuth(app: AppRecord, username: string, password: string): Promise<void>;
  disableBasicAuth(app: AppRecord): Promise<void>;
  health(): Promise<ServerHealth>;
}

function safeImageTag(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,255}$/.test(value)) throw new Error("Unsafe Docker image tag.");
  return value;
}

function nginxConfig(app: AppRecord, hostPort: number, config: ServerConfig, basicAuth: boolean): string {
  const auth = basicAuth
    ? `\n    auth_basic "Restricted";\n    auth_basic_user_file ${join(config.dataDir, "auth", `${app.id}.htpasswd`)};`
    : "";
  const proxy = `
    location / {
        proxy_pass http://127.0.0.1:${hostPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";${auth}
    }`;

  if (config.tlsCertificatePath && config.tlsKeyPath) {
    return `# Managed by DeployThisShit. Manual edits will be replaced.
server {
    listen 80;
    listen [::]:80;
    server_name ${app.domain};
    return 308 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${app.domain};
    ssl_certificate ${config.tlsCertificatePath};
    ssl_certificate_key ${config.tlsKeyPath};
    server_tokens off;
${proxy}
}
`;
  }

  return `# Managed by DeployThisShit. TLS is not configured yet.
server {
    listen 80;
    listen [::]:80;
    server_name ${app.domain};
    server_tokens off;
${proxy}
}
`;
}

async function spawnWithInput(command: string, args: string[], input: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with ${code}.`));
    });
    child.stdin.end(input);
  });
}

abstract class BaseDriver implements PlatformDriver {
  constructor(protected readonly config: ServerConfig) {}

  abstract prepareCandidate(
    app: AppRecord,
    deployment: DeploymentRecord,
    artifactPath: string,
    hostPort: number
  ): Promise<Candidate>;
  abstract route(app: AppRecord, candidate: Candidate): Promise<void>;
  abstract stopContainer(name: string): Promise<void>;
  abstract startContainer(name: string): Promise<void>;
  abstract setBasicAuth(app: AppRecord, username: string, password: string): Promise<void>;
  abstract disableBasicAuth(app: AppRecord): Promise<void>;

  async waitUntilHealthy(app: AppRecord, candidate: Candidate): Promise<void> {
    const url = `http://127.0.0.1:${candidate.hostPort}${app.healthPath}`;
    let lastError = "No response";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        if (response.status >= 200 && response.status < 400) return;
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Container did not become healthy at ${url}: ${lastError}`);
  }

  async health(): Promise<ServerHealth> {
    return {
      status: "healthy",
      hostname: hostname(),
      platform: platform(),
      architecture: process.arch,
      uptimeSeconds: Math.round(uptime()),
      loadAverage: Number(loadavg()[0]?.toFixed(2) || 0),
      memoryUsedPercent: Math.round(((totalmem() - freemem()) / totalmem()) * 100),
      diskUsedPercent: null,
      containerDriver: this.config.driver
    };
  }
}

export class MockPlatformDriver extends BaseDriver {
  private readonly running = new Set<string>();

  async prepareCandidate(
    app: AppRecord,
    deployment: DeploymentRecord,
    _artifactPath: string,
    hostPort: number
  ): Promise<Candidate> {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const containerName = `dts-${app.slug}-${deployment.release}`;
    this.running.add(containerName);
    return { containerName, hostPort };
  }

  override async waitUntilHealthy(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  async route(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async stopContainer(name: string): Promise<void> {
    this.running.delete(name);
  }

  async startContainer(name: string): Promise<void> {
    this.running.add(name);
  }

  async setBasicAuth(): Promise<void> {}
  async disableBasicAuth(): Promise<void> {}
}

export class SystemPlatformDriver extends BaseDriver {
  async prepareCandidate(
    app: AppRecord,
    deployment: DeploymentRecord,
    artifactPath: string,
    hostPort: number
  ): Promise<Candidate> {
    await execFile("docker", ["load", "--input", artifactPath], { maxBuffer: 10 * 1024 * 1024 });
    const containerName = `dts-${app.slug}-${deployment.release}-${deployment.id.slice(0, 6)}`;
    await execFile("docker", [
      "run",
      "--detach",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      "--publish",
      `127.0.0.1:${hostPort}:${app.containerPort}`,
      "--security-opt",
      "no-new-privileges:true",
      "--cap-drop",
      "ALL",
      "--label",
      `dev.deploythisshit.app=${app.id}`,
      "--label",
      `dev.deploythisshit.deployment=${deployment.id}`,
      safeImageTag(deployment.imageTag)
    ]);
    return { containerName, hostPort };
  }

  async route(app: AppRecord, candidate: Candidate): Promise<void> {
    await mkdir(this.config.nginxAvailableDir, { recursive: true });
    await mkdir(this.config.nginxEnabledDir, { recursive: true });
    const filename = `dts-${app.id}.conf`;
    const destination = join(this.config.nginxAvailableDir, filename);
    const temporary = `${destination}.tmp`;
    const previous = await readFile(destination, "utf8").catch(() => null);
    await writeFile(temporary, nginxConfig(app, candidate.hostPort, this.config, app.basicAuthEnabled), {
      mode: 0o644
    });
    await rename(temporary, destination);
    const enabled = join(this.config.nginxEnabledDir, filename);
    try {
      await unlink(enabled).catch(() => undefined);
      await symlink(destination, enabled);
      await execFile("nginx", ["-t"]);
      await execFile("nginx", ["-s", "reload"]);
    } catch (error) {
      await unlink(enabled).catch(() => undefined);
      if (previous === null) {
        await unlink(destination).catch(() => undefined);
      } else {
        await writeFile(temporary, previous, { mode: 0o644 });
        await rename(temporary, destination);
        await symlink(destination, enabled);
      }
      throw error;
    }
  }

  async stopContainer(name: string): Promise<void> {
    await execFile("docker", ["stop", "--time", "20", name]).catch(() => undefined);
  }

  async startContainer(name: string): Promise<void> {
    await execFile("docker", ["start", name]);
  }

  async setBasicAuth(app: AppRecord, username: string, password: string): Promise<void> {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new Error("Basic Auth username is invalid.");
    const authDir = join(this.config.dataDir, "auth");
    await mkdir(authDir, { recursive: true, mode: 0o700 });
    const output = await spawnWithInput("htpasswd", ["-Bni", username], `${password}\n`);
    const destination = join(authDir, `${app.id}.htpasswd`);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, output, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
    if (app.hostPort) await this.route({ ...app, basicAuthEnabled: true }, { containerName: "", hostPort: app.hostPort });
  }

  async disableBasicAuth(app: AppRecord): Promise<void> {
    await unlink(join(this.config.dataDir, "auth", `${app.id}.htpasswd`)).catch(() => undefined);
    if (app.hostPort) await this.route({ ...app, basicAuthEnabled: false }, { containerName: "", hostPort: app.hostPort });
  }
}

export function createPlatformDriver(config: ServerConfig): PlatformDriver {
  return config.driver === "system" ? new SystemPlatformDriver(config) : new MockPlatformDriver(config);
}
