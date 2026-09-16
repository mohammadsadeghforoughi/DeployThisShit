import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PairingService } from "./pairing.js";
import { Store } from "./store.js";
import { SecretsVault } from "./vault.js";

test("vault encrypts and authenticates provider secrets", () => {
  const vault = new SecretsVault(Buffer.alloc(32, 7));
  const encrypted = vault.encrypt("cloudflare-secret");
  assert.notEqual(encrypted, "cloudflare-secret");
  assert.equal(vault.decrypt(encrypted), "cloudflare-secret");
  assert.throws(() => vault.decrypt(`${encrypted}broken`));
});

test("store persists apps and authenticates revocable devices", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dts-store-test-"));
  const store = new Store(directory);
  try {
    const app = store.createApp({
      name: "Crane Web",
      slug: "crane-web",
      domain: "crane.apps.example.com",
      containerPort: 3000,
      healthPath: "/health"
    });
    assert.equal(store.getApp(app.id)?.domain, "crane.apps.example.com");

    const device = store.createDevice("Test laptop", "dts_test_token");
    assert.equal(store.authenticateDevice("dts_test_token")?.id, device.id);
    assert.equal(store.revokeDevice(device.id), true);
    assert.equal(store.authenticateDevice("dts_test_token"), null);
  } finally {
    store.close();
  }
});

test("pairing returns a token once after administrator approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dts-pairing-test-"));
  const store = new Store(directory);
  try {
    const service = new PairingService(store);
    const started = service.start("Studio laptop");
    assert.equal(service.poll(started.pairing.id, started.pollSecret).status, "pending");
    service.approve(started.pairing.id);
    const approved = service.poll(started.pairing.id, started.pollSecret);
    assert.equal(approved.status, "approved");
    assert.match(approved.token || "", /^dts_/);
    assert.throws(() => service.poll(started.pairing.id, started.pollSecret));
  } finally {
    store.close();
  }
});
