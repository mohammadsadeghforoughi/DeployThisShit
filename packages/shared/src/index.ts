export const API_VERSION = "v1";

export type AppStatus = "live" | "stopped" | "deploying" | "failed";
export type DeploymentStatus =
  | "uploaded"
  | "loading"
  | "starting"
  | "checking"
  | "routing"
  | "live"
  | "failed"
  | "superseded";

export interface AppRecord {
  id: string;
  name: string;
  slug: string;
  domain: string;
  containerPort: number;
  healthPath: string;
  status: AppStatus;
  currentRelease: string | null;
  currentDeploymentId: string | null;
  hostPort: number | null;
  basicAuthEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRecord {
  id: string;
  appId: string;
  imageTag: string;
  release: string;
  status: DeploymentStatus;
  sha256: string;
  containerName: string | null;
  hostPort: number | null;
  message: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface DeviceRecord {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface PendingPairing {
  id: string;
  code: string;
  deviceName: string;
  createdAt: string;
  expiresAt: string;
}

export interface ServerHealth {
  status: "healthy" | "degraded";
  hostname: string;
  platform: string;
  architecture: string;
  uptimeSeconds: number;
  loadAverage: number;
  memoryUsedPercent: number;
  diskUsedPercent: number | null;
  containerDriver: "mock" | "system";
}

export interface DashboardSnapshot {
  apps: AppRecord[];
  deployments: DeploymentRecord[];
  devices: DeviceRecord[];
  pendingPairings: PendingPairing[];
  server: ServerHealth;
  cloudflare: {
    configured: boolean;
    zoneId: string | null;
    serverIpv4: string | null;
  };
}

export interface Capabilities {
  apiVersion: string;
  architecture: string;
  platform: string;
  maxUploadBytes: number;
  chunkSizeBytes: number;
  driver: "mock" | "system";
}

export interface CreateAppInput {
  name: string;
  slug: string;
  domain: string;
  containerPort: number;
  healthPath?: string;
}

export interface CreateUploadInput {
  appId: string;
  imageTag: string;
  size: number;
  sha256: string;
}

export interface UploadRecord {
  id: string;
  appId: string;
  imageTag: string;
  size: number;
  sha256: string;
  offset: number;
  status: "pending" | "complete" | "failed";
  createdAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    recovery?: string;
  };
}

export interface DeploymentPlan {
  dockerfile: string;
  dockerignore: string;
  containerPort: number;
  healthPath: string;
  summary: string;
  warnings: string[];
}

export type AiProvider = "codex" | "claude" | "none";

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function isValidSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

export function isValidHostname(value: string): boolean {
  if (value.length < 1 || value.length > 253 || value.endsWith(".")) return false;
  const labels = value.toLowerCase().split(".");
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

export function normalizeHealthPath(value: string | undefined): string {
  const candidate = value?.trim() || "/";
  if (!candidate.startsWith("/") || candidate.includes("\n") || candidate.includes("\r")) {
    throw new Error("Health path must start with / and stay on one line.");
  }
  return candidate;
}

export function shortRelease(imageTag: string, sha256: string): string {
  const tag = imageTag.split(":").at(-1);
  if (tag && /^[a-f0-9]{7,64}$/i.test(tag)) return tag.slice(0, 7).toLowerCase();
  return sha256.replace(/^sha256:/, "").slice(0, 7).toLowerCase();
}

