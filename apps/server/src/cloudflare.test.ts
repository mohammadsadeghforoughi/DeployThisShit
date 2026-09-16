import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppRecord } from "@deploythisshit/shared";
import { CloudflareService } from "./cloudflare.js";
import { Store } from "./store.js";
import { SecretsVault } from "./vault.js";

test("Cloudflare records use direct DNS so Certbot TLS terminates on the server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dts-cloudflare-test-"));
  const store = new Store(directory);
  const service = new CloudflareService(store, new SecretsVault(Buffer.alloc(32, 9)));
  const originalFetch = globalThis.fetch;
  let submitted: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    if (!init?.method) {
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }
    submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ success: true, result: { id: "record-1" } }), { status: 200 });
  };

  try {
    service.configure({ token: "scoped-token", zoneId: "zone-1", serverIpv4: "203.0.113.10" });
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
      hostPort: 3000,
      basicAuthEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    assert.equal(await service.ensureRecord(app), "configured");
    assert.equal(submitted?.proxied, false);
    assert.equal(submitted?.content, "203.0.113.10");
    assert.equal(submitted?.comment, "managed-by=deploythisshit app=app-1");
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});
