import type { AppRecord, DashboardSnapshot } from "@deploythisshit/shared";

export class DashboardApi {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers });
    const body = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; recovery?: string };
    };
    if (!response.ok) {
      if (response.status === 401) sessionStorage.removeItem("dts-admin-token");
      throw new Error(body.error?.recovery
        ? `${body.error.message} ${body.error.recovery}`
        : body.error?.message || `Request failed with HTTP ${response.status}.`);
    }
    return body;
  }

  snapshot(): Promise<DashboardSnapshot> {
    return this.request("/api/v1/dashboard");
  }

  async action(appId: string, action: "start" | "stop" | "rollback"): Promise<AppRecord> {
    const body = await this.request<{ app: AppRecord }>(`/api/v1/apps/${appId}/${action}`, { method: "POST" });
    return body.app;
  }

  async basicAuth(
    appId: string,
    input: { enabled: boolean; username?: string; password?: string }
  ): Promise<AppRecord> {
    const body = await this.request<{ app: AppRecord }>(`/api/v1/apps/${appId}/basic-auth`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
    return body.app;
  }

  async approvePairing(id: string): Promise<void> {
    await this.request(`/api/v1/pairings/${id}/approve`, { method: "POST" });
  }

  async revokeDevice(id: string): Promise<void> {
    await this.request(`/api/v1/devices/${id}`, { method: "DELETE" });
  }

  async configureCloudflare(input: { token: string; zoneId: string; serverIpv4: string }): Promise<void> {
    await this.request("/api/v1/settings/cloudflare", { method: "PUT", body: JSON.stringify(input) });
  }
}

