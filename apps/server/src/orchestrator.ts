import { unlink } from "node:fs/promises";
import type { AppRecord } from "@deploythisshit/shared";
import type { CloudflareService } from "./cloudflare.js";
import type { PlatformDriver } from "./platform.js";
import type { Store } from "./store.js";

export class DeploymentOrchestrator {
  private readonly active = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly platform: PlatformDriver,
    private readonly cloudflare: CloudflareService
  ) {}

  async run(deploymentId: string): Promise<void> {
    if (this.active.has(deploymentId)) return;
    this.active.add(deploymentId);
    let candidateName: string | null = null;
    try {
      const deployment = this.store.getDeployment(deploymentId);
      if (!deployment) throw new Error("Deployment not found.");
      const app = this.store.getApp(deployment.appId);
      if (!app) throw new Error("Application not found.");
      const previousContainer = this.store.currentContainer(app.id);
      const hostPort = this.store.allocatePort();

      this.store.updateAppStatus(app.id, "deploying");
      this.store.updateDeployment(deployment.id, "loading", "Loading the verified image");
      const candidate = await this.platform.prepareCandidate(app, deployment, deployment.artifactPath, hostPort);
      candidateName = candidate.containerName;

      this.store.updateDeployment(deployment.id, "starting", "Candidate container started", {
        containerName: candidate.containerName,
        hostPort: candidate.hostPort
      });
      this.store.updateDeployment(deployment.id, "checking", `Checking ${app.healthPath}`);
      await this.platform.waitUntilHealthy(app, candidate);

      const dns = await this.cloudflare.ensureRecord(app);
      this.store.updateDeployment(
        deployment.id,
        "routing",
        dns === "configured" ? "DNS reconciled; activating route" : "Activating route; Cloudflare is not configured"
      );
      await this.platform.route(app, candidate);

      const live = this.store.getDeployment(deployment.id)!;
      this.store.markAppLive(app.id, live, candidate.containerName, candidate.hostPort);
      this.store.updateDeployment(deployment.id, "live", "Live and healthy", { finished: true });
      if (previousContainer && previousContainer !== candidate.containerName) {
        await this.platform.stopContainer(previousContainer);
        const previous = this.store.previousLiveDeployment(app.id, deployment.id);
        if (previous) this.store.updateDeployment(previous.id, "superseded", "Replaced by a newer release");
      }
      this.store.audit("device", "deployment.live", app.id, deployment.release);
      await unlink(deployment.artifactPath).catch(() => undefined);
    } catch (error) {
      const deployment = this.store.getDeployment(deploymentId);
      const message = error instanceof Error ? error.message : String(error);
      if (candidateName) await this.platform.stopContainer(candidateName).catch(() => undefined);
      if (deployment) {
        const app = this.store.getApp(deployment.appId);
        const hasPrevious = Boolean(app?.currentDeploymentId && app.currentDeploymentId !== deployment.id);
        this.store.updateDeployment(deployment.id, "failed", message, { finished: true });
        if (app) this.store.updateAppStatus(app.id, hasPrevious ? "live" : "failed");
        this.store.audit("system", "deployment.failed", deployment.appId, message);
      }
    } finally {
      this.active.delete(deploymentId);
    }
  }

  async stop(app: AppRecord): Promise<AppRecord> {
    const container = this.store.currentContainer(app.id);
    if (container) await this.platform.stopContainer(container);
    this.store.updateAppStatus(app.id, "stopped");
    this.store.audit("admin", "app.stop", app.id, app.domain);
    return this.store.getApp(app.id)!;
  }

  async start(app: AppRecord): Promise<AppRecord> {
    const container = this.store.currentContainer(app.id);
    if (!container || !app.hostPort) throw new Error("This app has no deployed container to start.");
    await this.platform.startContainer(container);
    const candidate = { containerName: container, hostPort: app.hostPort };
    await this.platform.waitUntilHealthy(app, candidate);
    await this.platform.route(app, candidate);
    this.store.updateAppStatus(app.id, "live");
    this.store.audit("admin", "app.start", app.id, app.domain);
    return this.store.getApp(app.id)!;
  }

  async rollback(app: AppRecord): Promise<AppRecord> {
    if (!app.currentDeploymentId) throw new Error("This app has no current release.");
    const replacedDeploymentId = app.currentDeploymentId;
    const previous = this.store.previousLiveDeployment(app.id, app.currentDeploymentId);
    if (!previous?.containerName || !previous.hostPort) throw new Error("No retained release is available to roll back to.");
    const currentContainer = this.store.currentContainer(app.id);
    await this.platform.startContainer(previous.containerName);
    const candidate = { containerName: previous.containerName, hostPort: previous.hostPort };
    await this.platform.waitUntilHealthy(app, candidate);
    await this.platform.route(app, candidate);
    if (currentContainer) await this.platform.stopContainer(currentContainer);
    this.store.markAppLive(app.id, previous, previous.containerName, previous.hostPort);
    if (replacedDeploymentId !== previous.id) {
      this.store.updateDeployment(replacedDeploymentId, "superseded", "Replaced by rollback", { finished: true });
    }
    this.store.updateDeployment(previous.id, "live", "Restored by rollback", { finished: true });
    this.store.audit("admin", "app.rollback", app.id, previous.release);
    return this.store.getApp(app.id)!;
  }

  async setBasicAuth(app: AppRecord, enabled: boolean, username?: string, password?: string): Promise<AppRecord> {
    if (enabled) {
      if (!username || !password || password.length < 10) {
        throw new Error("A username and password of at least 10 characters are required.");
      }
      await this.platform.setBasicAuth(app, username, password);
    } else {
      await this.platform.disableBasicAuth(app);
    }
    this.store.setBasicAuth(app.id, enabled);
    this.store.audit("admin", enabled ? "basic_auth.enable" : "basic_auth.disable", app.id, app.domain);
    return this.store.getApp(app.id)!;
  }
}
