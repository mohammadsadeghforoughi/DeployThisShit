import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppRecord, DeploymentRecord, ServerHealth } from "@deploythisshit/shared";
import type { CloudflareService } from "./cloudflare.js";
import { DeploymentOrchestrator } from "./orchestrator.js";
import type { Candidate, PlatformDriver } from "./platform.js";
import { Store } from "./store.js";

class RecordingPlatform implements PlatformDriver {
  readonly started: string[] = [];
  readonly stopped: string[] = [];

  async prepareCandidate(
    _app: AppRecord,
    _deployment: DeploymentRecord,
    _artifactPath: string,
    _hostPort: number
  ): Promise<Candidate> {
    throw new Error("Not used by this test.");
  }

  async waitUntilHealthy(): Promise<void> {}
  async route(): Promise<void> {}

  async stopContainer(name: string): Promise<void> {
    this.stopped.push(name);
  }

  async startContainer(name: string): Promise<void> {
    this.started.push(name);
  }

  async setBasicAuth(): Promise<void> {}
  async disableBasicAuth(): Promise<void> {}

  async health(): Promise<ServerHealth> {
    throw new Error("Not used by this test.");
  }
}

test("rollback leaves exactly the restored deployment live", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dts-rollback-test-"));
  const store = new Store(directory);
  try {
    const app = store.createApp({
      name: "Crane Web",
      slug: "crane-web",
      domain: "crane.apps.example.com",
      containerPort: 3000,
      healthPath: "/health"
    });
    const firstUpload = store.createUpload({
      appId: app.id,
      imageTag: "deploythisshit/crane-web:1111111",
      size: 10,
      sha256: "1".repeat(64),
      path: join(directory, "first.tar")
    });
    const first = store.createDeployment(store.getUpload(firstUpload.id)!);
    store.updateDeployment(first.id, "superseded", "Replaced", {
      containerName: "crane-first",
      hostPort: 20_000,
      finished: true
    });

    const secondUpload = store.createUpload({
      appId: app.id,
      imageTag: "deploythisshit/crane-web:2222222",
      size: 10,
      sha256: "2".repeat(64),
      path: join(directory, "second.tar")
    });
    const second = store.createDeployment(store.getUpload(secondUpload.id)!);
    store.updateDeployment(second.id, "live", "Live", {
      containerName: "crane-second",
      hostPort: 20_001,
      finished: true
    });
    store.markAppLive(app.id, second, "crane-second", 20_001);

    const platform = new RecordingPlatform();
    const orchestrator = new DeploymentOrchestrator(
      store,
      platform,
      null as unknown as CloudflareService
    );
    const restored = await orchestrator.rollback(store.getApp(app.id)!);

    assert.equal(restored.currentDeploymentId, first.id);
    assert.equal(store.getDeployment(first.id)?.status, "live");
    assert.equal(store.getDeployment(second.id)?.status, "superseded");
    assert.deepEqual(platform.started, ["crane-first"]);
    assert.deepEqual(platform.stopped, ["crane-second"]);
  } finally {
    store.close();
  }
});
