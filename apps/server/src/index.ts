import { createServer } from "node:http";
import { CloudflareService } from "./cloudflare.js";
import { loadConfig } from "./config.js";
import { createRequestHandler } from "./http.js";
import { DeploymentOrchestrator } from "./orchestrator.js";
import { PairingService } from "./pairing.js";
import { createPlatformDriver } from "./platform.js";
import { Store } from "./store.js";
import { SecretsVault } from "./vault.js";

const config = loadConfig();
const store = new Store(config.dataDir);
const vault = new SecretsVault(config.masterKey);
const platform = createPlatformDriver(config);
const cloudflare = new CloudflareService(store, vault);

const cloudflareEnvironment = {
  token: process.env.CLOUDFLARE_API_TOKEN,
  zoneId: process.env.CLOUDFLARE_ZONE_ID,
  serverIpv4: process.env.DTS_SERVER_IPV4
};
if (
  !cloudflare.status().configured &&
  cloudflareEnvironment.token &&
  cloudflareEnvironment.zoneId &&
  cloudflareEnvironment.serverIpv4
) {
  try {
    await cloudflare.verify({
      token: cloudflareEnvironment.token,
      zoneId: cloudflareEnvironment.zoneId,
      serverIpv4: cloudflareEnvironment.serverIpv4
    });
    cloudflare.configure({
      token: cloudflareEnvironment.token,
      zoneId: cloudflareEnvironment.zoneId,
      serverIpv4: cloudflareEnvironment.serverIpv4
    });
    store.audit("system", "cloudflare.bootstrap", cloudflareEnvironment.zoneId, cloudflareEnvironment.serverIpv4);
  } catch (error) {
    process.stderr.write(
      `Cloudflare environment bootstrap was ignored: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

const pairing = new PairingService(store);
const orchestrator = new DeploymentOrchestrator(store, platform, cloudflare);
const handler = createRequestHandler({ config, store, platform, cloudflare, pairing, orchestrator });

const server = createServer((req, res) => {
  void handler(req, res);
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`DeployThisShit agent listening on ${config.publicUrl} (${config.driver} driver)\n`);
});

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal}: shutting down\n`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
