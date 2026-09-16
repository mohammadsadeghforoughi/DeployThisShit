import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AppRecord,
  AppStatus,
  CreateAppInput,
  DeploymentRecord,
  DeploymentStatus,
  DeviceRecord,
  UploadRecord
} from "@deploythisshit/shared";
import { normalizeHealthPath, shortRelease } from "@deploythisshit/shared";

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appFromRow(row: Row): AppRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    domain: String(row.domain),
    containerPort: Number(row.container_port),
    healthPath: String(row.health_path),
    status: String(row.status) as AppStatus,
    currentRelease: row.current_release ? String(row.current_release) : null,
    currentDeploymentId: row.current_deployment_id ? String(row.current_deployment_id) : null,
    hostPort: row.host_port === null ? null : Number(row.host_port),
    basicAuthEnabled: Boolean(row.basic_auth_enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function deploymentFromRow(row: Row): DeploymentRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    imageTag: String(row.image_tag),
    release: String(row.release),
    status: String(row.status) as DeploymentStatus,
    sha256: String(row.sha256),
    containerName: row.container_name ? String(row.container_name) : null,
    hostPort: row.host_port === null ? null : Number(row.host_port),
    message: String(row.message),
    createdAt: String(row.created_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null
  };
}

function deviceFromRow(row: Row): DeviceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null
  };
}

function uploadFromRow(row: Row): UploadRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    imageTag: String(row.image_tag),
    size: Number(row.size),
    sha256: String(row.sha256),
    offset: Number(row.offset),
    status: String(row.status) as UploadRecord["status"],
    createdAt: String(row.created_at)
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dataDir, "deploythisshit.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL UNIQUE,
        container_port INTEGER NOT NULL,
        health_path TEXT NOT NULL,
        status TEXT NOT NULL,
        current_release TEXT,
        current_deployment_id TEXT,
        host_port INTEGER,
        current_container TEXT,
        basic_auth_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        image_tag TEXT NOT NULL,
        release TEXT NOT NULL,
        status TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        container_name TEXT,
        host_port INTEGER,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        image_tag TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        path TEXT NOT NULL,
        offset INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deployments_app_created ON deployments(app_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
    `);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? String(row.value) : null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now());
  }

  createDevice(name: string, token: string): DeviceRecord {
    const id = randomUUID();
    const createdAt = now();
    this.db.prepare(
      "INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)"
    ).run(id, name.slice(0, 100), hashToken(token), createdAt);
    return { id, name: name.slice(0, 100), createdAt, lastSeenAt: null, revokedAt: null };
  }

  authenticateDevice(token: string): DeviceRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL"
    ).get(hashToken(token)) as Row | undefined;
    if (!row) return null;
    const seenAt = now();
    this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(seenAt, String(row.id));
    return { ...deviceFromRow(row), lastSeenAt: seenAt };
  }

  listDevices(): DeviceRecord[] {
    return (this.db.prepare("SELECT * FROM devices ORDER BY created_at DESC").all() as Row[]).map(deviceFromRow);
  }

  revokeDevice(id: string): boolean {
    const result = this.db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), id);
    return Number(result.changes) > 0;
  }

  createApp(input: CreateAppInput): AppRecord {
    const id = randomUUID();
    const createdAt = now();
    this.db.prepare(`
      INSERT INTO apps (id, name, slug, domain, container_port, health_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'stopped', ?, ?)
    `).run(
      id,
      input.name.slice(0, 100),
      input.slug,
      input.domain.toLowerCase(),
      input.containerPort,
      normalizeHealthPath(input.healthPath),
      createdAt,
      createdAt
    );
    return this.getApp(id)!;
  }

  getApp(id: string): AppRecord | null {
    const row = this.db.prepare("SELECT * FROM apps WHERE id = ?").get(id) as Row | undefined;
    return row ? appFromRow(row) : null;
  }

  getAppBySlug(slug: string): AppRecord | null {
    const row = this.db.prepare("SELECT * FROM apps WHERE slug = ?").get(slug) as Row | undefined;
    return row ? appFromRow(row) : null;
  }

  listApps(): AppRecord[] {
    return (this.db.prepare("SELECT * FROM apps ORDER BY updated_at DESC").all() as Row[]).map(appFromRow);
  }

  updateAppStatus(id: string, status: AppStatus): void {
    this.db.prepare("UPDATE apps SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  }

  markAppLive(id: string, deployment: DeploymentRecord, containerName: string, hostPort: number): void {
    this.db.prepare(`
      UPDATE apps SET status = 'live', current_release = ?, current_deployment_id = ?,
        host_port = ?, current_container = ?, updated_at = ? WHERE id = ?
    `).run(deployment.release, deployment.id, hostPort, containerName, now(), id);
  }

  currentContainer(appId: string): string | null {
    const row = this.db.prepare("SELECT current_container FROM apps WHERE id = ?").get(appId) as Row | undefined;
    return row?.current_container ? String(row.current_container) : null;
  }

  setBasicAuth(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE apps SET basic_auth_enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, now(), id);
  }

  createUpload(input: { appId: string; imageTag: string; size: number; sha256: string; path: string }): UploadRecord {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO uploads (id, app_id, image_tag, size, sha256, path, offset, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?)
    `).run(id, input.appId, input.imageTag, input.size, input.sha256, input.path, now());
    return this.getUpload(id)!;
  }

  getUpload(id: string): (UploadRecord & { path: string }) | null {
    const row = this.db.prepare("SELECT * FROM uploads WHERE id = ?").get(id) as Row | undefined;
    return row ? { ...uploadFromRow(row), path: String(row.path) } : null;
  }

  updateUploadOffset(id: string, offset: number): void {
    this.db.prepare("UPDATE uploads SET offset = ? WHERE id = ?").run(offset, id);
  }

  completeUpload(id: string): void {
    this.db.prepare("UPDATE uploads SET status = 'complete' WHERE id = ?").run(id);
  }

  failUpload(id: string): void {
    this.db.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(id);
  }

  createDeployment(upload: UploadRecord & { path: string }): DeploymentRecord {
    const id = randomUUID();
    const createdAt = now();
    const release = shortRelease(upload.imageTag, upload.sha256);
    this.db.prepare(`
      INSERT INTO deployments (id, app_id, image_tag, release, status, sha256, artifact_path, message, created_at)
      VALUES (?, ?, ?, ?, 'uploaded', ?, ?, 'Artifact verified', ?)
    `).run(id, upload.appId, upload.imageTag, release, upload.sha256, upload.path, createdAt);
    return this.getDeployment(id)!;
  }

  getDeployment(id: string): (DeploymentRecord & { artifactPath: string }) | null {
    const row = this.db.prepare("SELECT * FROM deployments WHERE id = ?").get(id) as Row | undefined;
    return row ? { ...deploymentFromRow(row), artifactPath: String(row.artifact_path) } : null;
  }

  listDeployments(limit = 100): DeploymentRecord[] {
    return (this.db.prepare("SELECT * FROM deployments ORDER BY created_at DESC LIMIT ?").all(limit) as Row[])
      .map(deploymentFromRow);
  }

  listAppDeployments(appId: string): DeploymentRecord[] {
    return (this.db.prepare("SELECT * FROM deployments WHERE app_id = ? ORDER BY created_at DESC").all(appId) as Row[])
      .map(deploymentFromRow);
  }

  updateDeployment(
    id: string,
    status: DeploymentStatus,
    message: string,
    extra: { containerName?: string; hostPort?: number; finished?: boolean } = {}
  ): void {
    this.db.prepare(`
      UPDATE deployments SET status = ?, message = ?,
        container_name = COALESCE(?, container_name),
        host_port = COALESCE(?, host_port),
        finished_at = CASE WHEN ? THEN ? ELSE finished_at END
      WHERE id = ?
    `).run(
      status,
      message.slice(0, 500),
      extra.containerName ?? null,
      extra.hostPort ?? null,
      extra.finished ? 1 : 0,
      now(),
      id
    );
  }

  previousLiveDeployment(appId: string, currentId: string): DeploymentRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM deployments
      WHERE app_id = ? AND id != ? AND status IN ('live', 'superseded') AND container_name IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(appId, currentId) as Row | undefined;
    return row ? deploymentFromRow(row) : null;
  }

  allocatePort(): number {
    const row = this.db.prepare("SELECT MAX(host_port) AS max_port FROM deployments").get() as Row;
    return Math.max(20_000, Number(row.max_port || 19_999) + 1);
  }

  audit(actor: string, action: string, target: string, detail: string): void {
    this.db.prepare(
      "INSERT INTO audit_events (id, actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(randomUUID(), actor, action, target, detail.slice(0, 1000), now());
  }
}
