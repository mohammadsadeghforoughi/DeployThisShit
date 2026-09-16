import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./process.js";

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function releaseId(cwd: string): Promise<string> {
  try {
    const commit = await run("git", ["rev-parse", "--short=12", "HEAD"], { cwd, capture: true });
    if (/^[a-f0-9]{7,12}$/i.test(commit)) return commit.toLowerCase();
  } catch {
    // A project does not need Git to deploy.
  }
  return randomBytes(6).toString("hex");
}

export interface BuiltImage {
  imageTag: string;
  release: string;
  archivePath: string;
  size: number;
  sha256: string;
  cleanup(): Promise<void>;
}

export async function buildImage(cwd: string, slug: string, architecture: string): Promise<BuiltImage> {
  const release = await releaseId(cwd);
  const imageTag = `deploythisshit/${slug}:${release}`;
  const platform = architecture === "arm64" ? "linux/arm64" : "linux/amd64";
  await run("docker", ["build", "--platform", platform, "--tag", imageTag, "."], { cwd });

  const temporary = await mkdtemp(join(tmpdir(), "deploythisshit-image-"));
  const archivePath = join(temporary, `${slug}-${release}.tar`);
  await run("docker", ["save", "--output", archivePath, imageTag], { cwd });
  const metadata = await stat(archivePath);
  return {
    imageTag,
    release,
    archivePath,
    size: metadata.size,
    sha256: await fileSha256(archivePath),
    cleanup: () => rm(temporary, { recursive: true, force: true })
  };
}

