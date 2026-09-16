import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  publicUrl: string;
  dataDir: string;
  dashboardDir: string;
  driver: "mock" | "system";
  adminToken: string;
  masterKey: Buffer;
  maxUploadBytes: number;
  chunkSizeBytes: number;
  nginxAvailableDir: string;
  nginxEnabledDir: string;
  tlsCertificatePath: string | null;
  tlsKeyPath: string | null;
  tlsDomainSuffix: string | null;
}

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function resolveMasterKey(adminToken: string): Buffer {
  const configured = process.env.DTS_MASTER_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) throw new Error("DTS_MASTER_KEY must decode to exactly 32 bytes.");
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DTS_MASTER_KEY is required in production. Generate one with: openssl rand -base64 32");
  }
  return createHash("sha256").update(`dev-only:${adminToken}`).digest();
}

export function loadConfig(cwd = process.cwd()): ServerConfig {
  const driver = process.env.DTS_DRIVER === "system" ? "system" : "mock";
  const port = integerEnv("DTS_PORT", 8787);
  const dataDir = resolve(cwd, process.env.DTS_DATA_DIR || ".data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const adminToken = process.env.DTS_ADMIN_TOKEN || randomBytes(24).toString("base64url");
  if (!process.env.DTS_ADMIN_TOKEN) {
    process.stderr.write(`\nDevelopment admin token: ${adminToken}\nSet DTS_ADMIN_TOKEN to keep it stable.\n\n`);
  }

  return {
    host: process.env.DTS_HOST || "127.0.0.1",
    port,
    publicUrl: process.env.DTS_PUBLIC_URL || `http://127.0.0.1:${port}`,
    dataDir,
    dashboardDir: resolve(cwd, process.env.DTS_DASHBOARD_DIR || "apps/dashboard/dist"),
    driver,
    adminToken,
    masterKey: resolveMasterKey(adminToken),
    maxUploadBytes: integerEnv("DTS_MAX_UPLOAD_BYTES", 4 * 1024 * 1024 * 1024),
    chunkSizeBytes: integerEnv("DTS_CHUNK_SIZE_BYTES", 8 * 1024 * 1024),
    nginxAvailableDir: process.env.DTS_NGINX_AVAILABLE_DIR || "/etc/nginx/sites-available",
    nginxEnabledDir: process.env.DTS_NGINX_ENABLED_DIR || "/etc/nginx/sites-enabled",
    tlsCertificatePath: process.env.DTS_TLS_CERTIFICATE || null,
    tlsKeyPath: process.env.DTS_TLS_KEY || null,
    tlsDomainSuffix: process.env.DTS_TLS_DOMAIN_SUFFIX?.replace(/^\*?\.?/, "").toLowerCase() || null
  };
}
