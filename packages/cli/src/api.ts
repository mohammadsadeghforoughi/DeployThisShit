import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type {
  AppRecord,
  Capabilities,
  CreateAppInput,
  DeploymentRecord,
  UploadRecord
} from "@deploythisshit/shared";

interface ApiErrorPayload {
  error?: { message?: string; recovery?: string };
}

export class ApiClient {
  constructor(
    readonly serverUrl: string,
    private readonly token: string | null
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.serverUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
      const message = payload.error?.message || `Server returned HTTP ${response.status}.`;
      throw new Error(payload.error?.recovery ? `${message} ${payload.error.recovery}` : message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  health(): Promise<{ ok: boolean }> {
    return this.request("/api/v1/health");
  }

  capabilities(): Promise<Capabilities> {
    return this.request("/api/v1/capabilities");
  }

  async listApps(): Promise<AppRecord[]> {
    const response = await this.request<{ apps: AppRecord[] }>("/api/v1/apps");
    return response.apps;
  }

  async createApp(input: CreateAppInput): Promise<AppRecord> {
    const response = await this.request<{ app: AppRecord }>("/api/v1/apps", {
      method: "POST",
      body: JSON.stringify(input)
    });
    return response.app;
  }

  startPairing(deviceName: string): Promise<{
    pairingId: string;
    pollSecret: string;
    code: string;
    expiresAt: string;
    approvalUrl: string;
  }> {
    return this.request("/api/v1/pairings", { method: "POST", body: JSON.stringify({ deviceName }) });
  }

  pollPairing(pairingId: string, pollSecret: string): Promise<{ status: "pending" | "approved"; token?: string }> {
    return this.request(`/api/v1/pairings/${pairingId}`, { headers: { "X-Pairing-Secret": pollSecret } });
  }

  approvePairing(pairingId: string): Promise<void> {
    return this.request(`/api/v1/pairings/${pairingId}/approve`, { method: "POST" });
  }

  async createUpload(input: {
    appId: string;
    imageTag: string;
    size: number;
    sha256: string;
  }): Promise<{ upload: UploadRecord; chunkSizeBytes: number }> {
    return this.request("/api/v1/uploads", { method: "POST", body: JSON.stringify(input) });
  }

  async uploadFile(upload: UploadRecord, filePath: string, chunkSize: number, onProgress: (sent: number) => void): Promise<void> {
    const file = await open(filePath, "r");
    try {
      let offset = upload.offset;
      while (offset < upload.size) {
        const length = Math.min(chunkSize, upload.size - offset);
        const chunk = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(chunk, 0, length, offset);
        if (bytesRead === 0) throw new Error("Image archive ended before its declared size.");
        const response = await fetch(`${this.serverUrl}/api/v1/uploads/${upload.id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/octet-stream",
            "Upload-Offset": String(offset)
          },
          body: chunk.subarray(0, bytesRead)
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ApiErrorPayload;
          throw new Error(body.error?.message || `Upload failed with HTTP ${response.status}.`);
        }
        offset = Number.parseInt(response.headers.get("Upload-Offset") || String(offset + bytesRead), 10);
        onProgress(offset);
      }
    } finally {
      await file.close();
    }
  }

  async finalizeUpload(uploadId: string): Promise<DeploymentRecord> {
    const response = await this.request<{ deployment: DeploymentRecord }>(`/api/v1/uploads/${uploadId}/finalize`, {
      method: "POST"
    });
    return response.deployment;
  }

  async deployment(id: string): Promise<DeploymentRecord> {
    const response = await this.request<{ deployment: DeploymentRecord }>(`/api/v1/deployments/${id}`);
    return response.deployment;
  }
}

