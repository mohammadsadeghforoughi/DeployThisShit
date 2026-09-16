import { randomBytes, randomUUID } from "node:crypto";
import type { PendingPairing } from "@deploythisshit/shared";
import type { Store } from "./store.js";

interface PairingState extends PendingPairing {
  pollSecret: string;
  approvedToken: string | null;
  consumed: boolean;
}

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export class PairingService {
  private readonly pairings = new Map<string, PairingState>();

  constructor(private readonly store: Store) {}

  start(deviceName: string): { pairing: PendingPairing; pollSecret: string } {
    this.prune();
    const id = randomUUID();
    const createdAt = new Date();
    const state: PairingState = {
      id,
      code: code(),
      deviceName: deviceName.trim().slice(0, 100) || "Unnamed device",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 10 * 60_000).toISOString(),
      pollSecret: randomBytes(24).toString("base64url"),
      approvedToken: null,
      consumed: false
    };
    this.pairings.set(id, state);
    return { pairing: this.publicState(state), pollSecret: state.pollSecret };
  }

  list(): PendingPairing[] {
    this.prune();
    return Array.from(this.pairings.values())
      .filter((pairing) => !pairing.approvedToken && !pairing.consumed)
      .map((pairing) => this.publicState(pairing));
  }

  approve(id: string): void {
    const pairing = this.pairings.get(id);
    if (!pairing || pairing.consumed || Date.parse(pairing.expiresAt) <= Date.now()) {
      throw new Error("Pairing request is missing or expired.");
    }
    if (pairing.approvedToken) return;
    const token = `dts_${randomBytes(32).toString("base64url")}`;
    this.store.createDevice(pairing.deviceName, token);
    pairing.approvedToken = token;
    this.store.audit("admin", "device.approve", pairing.deviceName, `Pairing code ${pairing.code}`);
  }

  poll(id: string, pollSecret: string): { status: "pending" | "approved"; token?: string } {
    const pairing = this.pairings.get(id);
    if (!pairing || pairing.pollSecret !== pollSecret || Date.parse(pairing.expiresAt) <= Date.now()) {
      throw new Error("Pairing request is missing or expired.");
    }
    if (!pairing.approvedToken) return { status: "pending" };
    if (pairing.consumed) throw new Error("Pairing credentials were already collected.");
    pairing.consumed = true;
    const token = pairing.approvedToken;
    setTimeout(() => this.pairings.delete(id), 30_000).unref();
    return { status: "approved", token };
  }

  private publicState(pairing: PairingState): PendingPairing {
    return {
      id: pairing.id,
      code: pairing.code,
      deviceName: pairing.deviceName,
      createdAt: pairing.createdAt,
      expiresAt: pairing.expiresAt
    };
  }

  private prune(): void {
    const timestamp = Date.now();
    for (const [id, pairing] of this.pairings) {
      if (Date.parse(pairing.expiresAt) <= timestamp || pairing.consumed) this.pairings.delete(id);
    }
  }
}

