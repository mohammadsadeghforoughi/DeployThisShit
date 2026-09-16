import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIPv4 } from "node:net";
import type { CreateAppInput, CreateUploadInput } from "@deploythisshit/shared";
import { API_VERSION, isValidHostname, isValidSlug, normalizeHealthPath } from "@deploythisshit/shared";
import type { CloudflareService } from "./cloudflare.js";
import type { ServerConfig } from "./config.js";
import type { DeploymentOrchestrator } from "./orchestrator.js";
import type { PairingService } from "./pairing.js";
import type { PlatformDriver } from "./platform.js";
import type { Store } from "./store.js";

interface Dependencies {
  config: ServerConfig;
  store: Store;
  pairing: PairingService;
  platform: PlatformDriver;
  cloudflare: CloudflareService;
  orchestrator: DeploymentOrchestrator;
}

interface AuthContext {
  role: "admin" | "device";
  actor: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly recovery?: string
  ) {
    super(message);
  }
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

function authenticate(req: IncomingMessage, deps: Dependencies): AuthContext {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "authentication_required", "A bearer token is required.", "Pair this device or sign in to the dashboard.");
  if (sameSecret(token, deps.config.adminToken)) return { role: "admin", actor: "admin" };
  const device = deps.store.authenticateDevice(token);
  if (!device) throw new HttpError(401, "invalid_token", "The device token is invalid or revoked.", "Run deploythisshit init to pair again.");
  return { role: "device", actor: device.id };
}

function requireAdmin(auth: AuthContext): void {
  if (auth.role !== "admin") throw new HttpError(403, "admin_required", "This action requires dashboard administrator access.");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(payload);
}

async function readBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "body_too_large", `Request body exceeds ${maxBytes} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBuffer(req, 1024 * 1024);
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function appOrThrow(store: Store, id: string) {
  const app = store.getApp(id);
  if (!app) throw new HttpError(404, "app_not_found", "Application not found.");
  return app;
}

function validateCreateApp(input: CreateAppInput, config: ServerConfig): CreateAppInput {
  if (!input.name?.trim()) throw new HttpError(400, "invalid_name", "Application name is required.");
  if (!isValidSlug(input.slug)) throw new HttpError(400, "invalid_slug", "Slug must contain lowercase letters, numbers, or internal hyphens.");
  if (!isValidHostname(input.domain)) throw new HttpError(400, "invalid_domain", "Domain must be a valid public hostname.");
  if (config.tlsDomainSuffix) {
    const suffix = config.tlsDomainSuffix;
    const domain = input.domain.toLowerCase();
    const label = domain.endsWith(`.${suffix}`) ? domain.slice(0, -(suffix.length + 1)) : "";
    if (!label || label.includes(".")) {
      throw new HttpError(
        400,
        "domain_not_covered_by_tls",
        `Domain must be a single-label hostname under *.${suffix}.`,
        "Choose a hostname covered by the server wildcard certificate."
      );
    }
  }
  if (!Number.isInteger(input.containerPort) || input.containerPort < 1 || input.containerPort > 65_535) {
    throw new HttpError(400, "invalid_port", "Container port must be between 1 and 65535.");
  }
  return { ...input, healthPath: normalizeHealthPath(input.healthPath) };
}

function contentType(path: string): string {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2"
    }[extname(path)] || "application/octet-stream"
  );
}

async function serveDashboard(pathname: string, deps: Dependencies, res: ServerResponse): Promise<void> {
  const root = resolve(deps.config.dashboardDir);
  let requested = pathname === "/" ? join(root, "index.html") : resolve(root, `.${pathname}`);
  if (!requested.startsWith(`${root}${sep}`) && requested !== join(root, "index.html")) {
    throw new HttpError(404, "not_found", "Not found.");
  }
  if (!existsSync(requested) || (await stat(requested)).isDirectory()) requested = join(root, "index.html");
  if (!existsSync(requested)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Dashboard is not built. Run npm run build -w @deploythisshit/dashboard.");
    return;
  }
  const body = await readFile(requested);
  res.writeHead(200, {
    "Content-Type": contentType(requested),
    "Content-Length": body.length,
    "Cache-Control": requested.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  });
  res.end(body);
}

export function createRequestHandler(deps: Dependencies) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", deps.config.publicUrl);
      const path = url.pathname;

      if (method === "GET" && path === "/api/v1/health") {
        sendJson(res, 200, { ok: true, version: API_VERSION });
        return;
      }

      if (method === "POST" && path === "/api/v1/pairings") {
        const input = await readJson<{ deviceName?: string }>(req);
        const started = deps.pairing.start(input.deviceName || "Developer device");
        sendJson(res, 201, {
          pairingId: started.pairing.id,
          pollSecret: started.pollSecret,
          code: started.pairing.code,
          expiresAt: started.pairing.expiresAt,
          approvalUrl: `${deps.config.publicUrl}/?pair=${started.pairing.id}`
        });
        return;
      }

      const pairingPoll = path.match(/^\/api\/v1\/pairings\/([a-f0-9-]+)$/);
      if (method === "GET" && pairingPoll) {
        const pollSecret = req.headers["x-pairing-secret"];
        if (typeof pollSecret !== "string") throw new HttpError(401, "pairing_secret_required", "Pairing poll secret is required.");
        sendJson(res, 200, deps.pairing.poll(pairingPoll[1]!, pollSecret));
        return;
      }

      if (!path.startsWith("/api/")) {
        await serveDashboard(path, deps, res);
        return;
      }

      const auth = authenticate(req, deps);

      if (method === "GET" && path === "/api/v1/capabilities") {
        sendJson(res, 200, {
          apiVersion: API_VERSION,
          architecture: process.arch,
          platform: process.platform,
          maxUploadBytes: deps.config.maxUploadBytes,
          chunkSizeBytes: deps.config.chunkSizeBytes,
          driver: deps.config.driver
        });
        return;
      }

      if (method === "GET" && path === "/api/v1/apps") {
        sendJson(res, 200, { apps: deps.store.listApps() });
        return;
      }

      if (method === "POST" && path === "/api/v1/apps") {
        const app = deps.store.createApp(validateCreateApp(await readJson<CreateAppInput>(req), deps.config));
        deps.store.audit(auth.actor, "app.create", app.id, app.domain);
        sendJson(res, 201, { app });
        return;
      }

      if (method === "POST" && path === "/api/v1/uploads") {
        const input = await readJson<CreateUploadInput>(req);
        appOrThrow(deps.store, input.appId);
        if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > deps.config.maxUploadBytes) {
          throw new HttpError(400, "invalid_upload_size", `Upload size must be between 1 and ${deps.config.maxUploadBytes} bytes.`);
        }
        if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(input.sha256)) {
          throw new HttpError(400, "invalid_digest", "Upload SHA-256 digest is invalid.");
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,255}$/.test(input.imageTag)) {
          throw new HttpError(400, "invalid_image_tag", "Docker image tag is invalid.");
        }
        const uploadsDir = join(deps.config.dataDir, "uploads");
        await mkdir(uploadsDir, { recursive: true, mode: 0o700 });
        const artifactPath = join(uploadsDir, `${randomUUID()}.tar`);
        const upload = deps.store.createUpload({ ...input, sha256: input.sha256.replace(/^sha256:/, ""), path: artifactPath });
        sendJson(res, 201, { upload, chunkSizeBytes: deps.config.chunkSizeBytes });
        return;
      }

      const uploadMatch = path.match(/^\/api\/v1\/uploads\/([a-f0-9-]+)$/);
      if (uploadMatch && method === "HEAD") {
        const upload = deps.store.getUpload(uploadMatch[1]!);
        if (!upload) throw new HttpError(404, "upload_not_found", "Upload not found.");
        res.writeHead(204, { "Upload-Offset": String(upload.offset), "Upload-Length": String(upload.size) });
        res.end();
        return;
      }

      if (uploadMatch && method === "PATCH") {
        const upload = deps.store.getUpload(uploadMatch[1]!);
        if (!upload) throw new HttpError(404, "upload_not_found", "Upload not found.");
        if (upload.status !== "pending") throw new HttpError(409, "upload_closed", "Upload is no longer writable.");
        const requestedOffset = Number.parseInt(String(req.headers["upload-offset"] || "-1"), 10);
        if (requestedOffset !== upload.offset) {
          throw new HttpError(409, "offset_mismatch", `Expected upload offset ${upload.offset}.`);
        }
        const chunk = await readBuffer(req, deps.config.chunkSizeBytes);
        if (upload.offset + chunk.length > upload.size) throw new HttpError(413, "upload_overflow", "Chunk exceeds declared upload size.");
        await appendFile(upload.path, chunk, { mode: 0o600 });
        const nextOffset = upload.offset + chunk.length;
        deps.store.updateUploadOffset(upload.id, nextOffset);
        res.writeHead(204, { "Upload-Offset": String(nextOffset) });
        res.end();
        return;
      }

      const finalizeMatch = path.match(/^\/api\/v1\/uploads\/([a-f0-9-]+)\/finalize$/);
      if (finalizeMatch && method === "POST") {
        const upload = deps.store.getUpload(finalizeMatch[1]!);
        if (!upload) throw new HttpError(404, "upload_not_found", "Upload not found.");
        if (upload.offset !== upload.size) throw new HttpError(409, "upload_incomplete", `Upload has ${upload.offset} of ${upload.size} bytes.`);
        const digest = await sha256File(upload.path);
        if (!sameSecret(digest, upload.sha256)) {
          deps.store.failUpload(upload.id);
          throw new HttpError(422, "digest_mismatch", "Uploaded image archive failed SHA-256 verification.", "Retry the upload from the beginning.");
        }
        deps.store.completeUpload(upload.id);
        const deployment = deps.store.createDeployment(upload);
        deps.store.audit(auth.actor, "upload.complete", upload.appId, digest);
        void deps.orchestrator.run(deployment.id);
        sendJson(res, 202, { deployment });
        return;
      }

      const deploymentMatch = path.match(/^\/api\/v1\/deployments\/([a-f0-9-]+)$/);
      if (deploymentMatch && method === "GET") {
        const deployment = deps.store.getDeployment(deploymentMatch[1]!);
        if (!deployment) throw new HttpError(404, "deployment_not_found", "Deployment not found.");
        const { artifactPath: _privatePath, ...publicDeployment } = deployment;
        sendJson(res, 200, { deployment: publicDeployment });
        return;
      }

      const actionMatch = path.match(/^\/api\/v1\/apps\/([a-f0-9-]+)\/(start|stop|rollback)$/);
      if (actionMatch && method === "POST") {
        requireAdmin(auth);
        const app = appOrThrow(deps.store, actionMatch[1]!);
        const action = actionMatch[2];
        const updated = action === "start"
          ? await deps.orchestrator.start(app)
          : action === "stop"
            ? await deps.orchestrator.stop(app)
            : await deps.orchestrator.rollback(app);
        sendJson(res, 200, { app: updated });
        return;
      }

      const basicAuthMatch = path.match(/^\/api\/v1\/apps\/([a-f0-9-]+)\/basic-auth$/);
      if (basicAuthMatch && method === "PUT") {
        requireAdmin(auth);
        const app = appOrThrow(deps.store, basicAuthMatch[1]!);
        const input = await readJson<{ enabled: boolean; username?: string; password?: string }>(req);
        const updated = await deps.orchestrator.setBasicAuth(app, Boolean(input.enabled), input.username, input.password);
        sendJson(res, 200, { app: updated });
        return;
      }

      if (method === "GET" && path === "/api/v1/dashboard") {
        requireAdmin(auth);
        sendJson(res, 200, {
          apps: deps.store.listApps(),
          deployments: deps.store.listDeployments(),
          devices: deps.store.listDevices(),
          pendingPairings: deps.pairing.list(),
          server: await deps.platform.health(),
          cloudflare: deps.cloudflare.status()
        });
        return;
      }

      const approveMatch = path.match(/^\/api\/v1\/pairings\/([a-f0-9-]+)\/approve$/);
      if (approveMatch && method === "POST") {
        requireAdmin(auth);
        deps.pairing.approve(approveMatch[1]!);
        sendJson(res, 200, { approved: true });
        return;
      }

      const deviceMatch = path.match(/^\/api\/v1\/devices\/([a-f0-9-]+)$/);
      if (deviceMatch && method === "DELETE") {
        requireAdmin(auth);
        if (!deps.store.revokeDevice(deviceMatch[1]!)) throw new HttpError(404, "device_not_found", "Active device not found.");
        deps.store.audit(auth.actor, "device.revoke", deviceMatch[1]!, "Revoked from dashboard");
        sendJson(res, 200, { revoked: true });
        return;
      }

      if (method === "PUT" && path === "/api/v1/settings/cloudflare") {
        requireAdmin(auth);
        const input = await readJson<{ token?: string; zoneId?: string; serverIpv4?: string }>(req);
        if (!input.token || !input.zoneId || !input.serverIpv4) {
          throw new HttpError(400, "cloudflare_fields_required", "Token, zone ID, and server IPv4 are required.");
        }
        if (!isIPv4(input.serverIpv4)) throw new HttpError(400, "invalid_ipv4", "Server IPv4 is invalid.");
        await deps.cloudflare.verify({ token: input.token, zoneId: input.zoneId, serverIpv4: input.serverIpv4 });
        deps.cloudflare.configure({ token: input.token, zoneId: input.zoneId, serverIpv4: input.serverIpv4 });
        deps.store.audit(auth.actor, "cloudflare.configure", input.zoneId, input.serverIpv4);
        sendJson(res, 200, { configured: true });
        return;
      }

      throw new HttpError(404, "not_found", "API route not found.");
    } catch (error) {
      const httpError = error instanceof HttpError
        ? error
        : new HttpError(500, "internal_error", error instanceof Error ? error.message : "Unexpected server error.");
      if (httpError.status >= 500) process.stderr.write(`${new Date().toISOString()} ${httpError.message}\n`);
      sendJson(res, httpError.status, {
        error: {
          code: httpError.code,
          message: httpError.message,
          ...(httpError.recovery ? { recovery: httpError.recovery } : {})
        }
      });
    }
  };
}
