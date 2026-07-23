import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));

test("manifest is Chrome MV3 and declares the extension UI entry points", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background?.service_worker, "background/service-worker.js");
  assert.equal(manifest.background?.type, "module");
  assert.equal(manifest.action?.default_popup, undefined);
  assert.equal(manifest.action?.default_title, "Video Transcript");
  assert.equal(manifest.side_panel?.default_path, "sidepanel/index.html");
  assert.equal(manifest.permissions.includes("activeTab"), true);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.deepEqual(manifest.host_permissions ?? [], []);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.content_scripts, undefined);
});

test("release versions stay in lockstep", () => {
  assert.equal(manifest.version, packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.[""]?.version, packageJson.version);
});

test("manifest keeps browser support Chrome-only at source level", () => {
  assert.equal(manifest.browser_specific_settings, undefined);
  assert.equal(manifest.applications, undefined);
  assert.equal(manifest.sidebar_action, undefined);
  assert.equal(packageJson.devDependencies?.[["web", "ext"].join("-")], undefined);
});

test("manifest has no AI provider host permissions", () => {
  const serialized = JSON.stringify({
    optional_host_permissions: manifest.optional_host_permissions,
    content_security_policy: manifest.content_security_policy,
  });
  const blockedHosts = [
    ["api", "open" + "ai", "com"].join("."),
    ["api", "anth" + "ropic", "com"].join("."),
    "generative" + "language.googleapis.com",
    "localhost",
  ];
  for (const host of blockedHosts) {
    assert.equal(serialized.includes(host), false);
  }
});

test("extension fetches permitted timed-text origins without platform-specific CSP entries", () => {
  const policy = manifest.content_security_policy?.extension_pages ?? "";
  assert.match(policy, /connect-src 'self' http: https:/);
  assert.doesNotMatch(policy, /youtube|googlevideo|vimeo/i);
});
