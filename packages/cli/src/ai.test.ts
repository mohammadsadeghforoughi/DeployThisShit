import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deterministicPlan } from "./ai.js";

test("deterministic fallback detects a Node project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dts-plan-test-"));
  await writeFile(join(directory, "package.json"), "{}");
  const plan = deterministicPlan(directory);
  assert.equal(plan.containerPort, 3000);
  assert.match(plan.dockerfile, /FROM node:22/);
  assert.match(plan.dockerignore, /\.env\*/);
});
