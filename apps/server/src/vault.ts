import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretsVault {
  constructor(private readonly key: Buffer) {}

  encrypt(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${nonce.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  decrypt(payload: string): string {
    const [version, noncePart, tagPart, dataPart] = payload.split(".");
    if (version !== "v1" || !noncePart || !tagPart || !dataPart) throw new Error("Unsupported encrypted secret.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(noncePart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final()
    ]).toString("utf8");
  }
}

