import type { AppRecord } from "@deploythisshit/shared";
import { isIPv4 } from "node:net";
import type { Store } from "./store.js";
import type { SecretsVault } from "./vault.js";

interface CloudflareConfig {
  token: string;
  zoneId: string;
  serverIpv4: string;
}

interface CloudflareRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  comment?: string;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message: string }>;
}

export class CloudflareService {
  constructor(
    private readonly store: Store,
    private readonly vault: SecretsVault
  ) {}

  status(): { configured: boolean; zoneId: string | null; serverIpv4: string | null } {
    return {
      configured: Boolean(this.store.getSetting("cloudflare.token")),
      zoneId: this.store.getSetting("cloudflare.zone_id"),
      serverIpv4: this.store.getSetting("cloudflare.server_ipv4")
    };
  }

  configure(config: CloudflareConfig): void {
    if (!isIPv4(config.serverIpv4)) throw new Error("Cloudflare server IPv4 is invalid.");
    this.store.setSetting("cloudflare.token", this.vault.encrypt(config.token));
    this.store.setSetting("cloudflare.zone_id", config.zoneId);
    this.store.setSetting("cloudflare.server_ipv4", config.serverIpv4);
  }

  private config(): CloudflareConfig | null {
    const encrypted = this.store.getSetting("cloudflare.token");
    const zoneId = this.store.getSetting("cloudflare.zone_id");
    const serverIpv4 = this.store.getSetting("cloudflare.server_ipv4");
    if (!encrypted || !zoneId || !serverIpv4) return null;
    return { token: this.vault.decrypt(encrypted), zoneId, serverIpv4 };
  }

  async verify(config: CloudflareConfig): Promise<void> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}`, {
      headers: { Authorization: `Bearer ${config.token}` }
    });
    const body = (await response.json()) as CloudflareResponse<unknown>;
    if (!response.ok || !body.success) {
      throw new Error(body.errors?.[0]?.message || `Cloudflare verification failed with HTTP ${response.status}.`);
    }
  }

  async ensureRecord(app: AppRecord): Promise<"configured" | "skipped"> {
    const config = this.config();
    if (!config) return "skipped";

    const endpoint = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}/dns_records`;
    const listResponse = await fetch(`${endpoint}?type=A&name=${encodeURIComponent(app.domain)}`, {
      headers: { Authorization: `Bearer ${config.token}` }
    });
    const listBody = (await listResponse.json()) as CloudflareResponse<CloudflareRecord[]>;
    if (!listResponse.ok || !listBody.success) {
      throw new Error(listBody.errors?.[0]?.message || "Cloudflare DNS lookup failed.");
    }

    const existing = listBody.result[0];
    const comment = `managed-by=deploythisshit app=${app.id}`;
    if (existing && existing.comment !== comment) {
      throw new Error(`DNS record ${app.domain} already exists and is not owned by DeployThisShit.`);
    }

    const request = {
      type: "A",
      name: app.domain,
      content: config.serverIpv4,
      ttl: 1,
      proxied: true,
      comment
    };
    const response = await fetch(existing ? `${endpoint}/${encodeURIComponent(existing.id)}` : endpoint, {
      method: existing ? "PUT" : "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request)
    });
    const body = (await response.json()) as CloudflareResponse<CloudflareRecord>;
    if (!response.ok || !body.success) {
      throw new Error(body.errors?.[0]?.message || "Cloudflare DNS update failed.");
    }
    return "configured";
  }
}
