import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AppRecord } from "@deploythisshit/shared";
import type { ServerConfig } from "./config.js";
import { nginxConfig } from "./platform.js";

const app: AppRecord = {
  id: "app-1",
  name: "Example",
  slug: "example",
  domain: "example.apps.example.com",
  containerPort: 3000,
  healthPath: "/",
  status: "live",
  currentRelease: null,
  currentDeploymentId: null,
  hostPort: 20_001,
  basicAuthEnabled: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 8787,
  publicUrl: "https://deploy.example.com",
  dataDir: "/var/lib/deploythisshit",
  dashboardDir: "/opt/deploythisshit/apps/dashboard/dist",
  driver: "system",
  adminToken: "test-token",
  masterKey: Buffer.alloc(32),
  maxUploadBytes: 1,
  chunkSizeBytes: 1,
  nginxAvailableDir: "/etc/nginx/sites-available",
  nginxEnabledDir: "/etc/nginx/sites-enabled",
  tlsCertificatePath: "/etc/letsencrypt/live/deploythisshit/fullchain.pem",
  tlsKeyPath: "/etc/letsencrypt/live/deploythisshit/privkey.pem",
  tlsDomainSuffix: "apps.example.com"
};

function assertUbuntuCompatibleHttp2(value: string): void {
  assert.match(value, /listen 443 ssl http2;/);
  assert.match(value, /listen \[::\]:443 ssl http2;/);
  assert.doesNotMatch(value, /http2 on;/);
}

test("generated application routes use Ubuntu-compatible HTTP/2 syntax", () => {
  assertUbuntuCompatibleHttp2(nginxConfig(app, 20_001, config, false));
});

test("dashboard template uses Ubuntu-compatible HTTP/2 syntax", async () => {
  const template = await readFile(new URL("../../../deploy/nginx-dashboard-tls.conf", import.meta.url), "utf8");
  assertUbuntuCompatibleHttp2(template);
});
