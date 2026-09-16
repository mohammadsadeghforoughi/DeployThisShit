import assert from "node:assert/strict";
import test from "node:test";
import { isValidHostname, isValidSlug, normalizeHealthPath, slugify } from "./index.js";

test("slugify produces DNS-safe application slugs", () => {
  assert.equal(slugify("  Crane Web!!! "), "crane-web");
  assert.equal(isValidSlug("crane-web"), true);
  assert.equal(isValidSlug("Crane_Web"), false);
});

test("hostname validation rejects Nginx injection and incomplete names", () => {
  assert.equal(isValidHostname("crane.apps.example.com"), true);
  assert.equal(isValidHostname("localhost"), false);
  assert.equal(isValidHostname("bad.example.com; return 200"), false);
  assert.equal(isValidHostname("-bad.example.com"), false);
});

test("health paths cannot contain newlines", () => {
  assert.equal(normalizeHealthPath("/health"), "/health");
  assert.throws(() => normalizeHealthPath("/health\nproxy_pass bad"));
});
