#!/usr/bin/env node
/**
 * Push the AMO listing description from store/listing.md to addons.mozilla.org.
 *
 * The description lives in the repo so the published copy has a reviewed
 * source; this script is the only thing that should write it. AMO's developer
 * hub sits behind a Mozilla account and a bot challenge, so editing by hand in
 * a browser is the slow path.
 *
 * Credentials (env):
 *   AMO_JWT_ISSUER   AMO API key   (addons.mozilla.org -> Manage API Keys)
 *   AMO_JWT_SECRET   AMO API secret
 *
 * Usage:
 *   node scripts/publish/update-amo-listing.mjs show     # print what AMO has now
 *   node scripts/publish/update-amo-listing.mjs diff     # local vs live
 *   node scripts/publish/update-amo-listing.mjs apply    # write it
 *
 * Docs: https://addons-server.readthedocs.io/en/latest/topics/api/addons.html
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const API_ROOT = "https://addons.mozilla.org/api/v5";
const ADDON_ID = "video-transcript";
const LOCALE = "en-US";

main().catch((err) => {
  console.error(`\n✘ ${err.message}`);
  process.exit(1);
});

async function main() {
  const command = process.argv[2] ?? "help";
  if (command === "help") return usage();

  if (command === "show") {
    const live = await liveDescription();
    console.log(live);
    return;
  }

  const local = localDescription();

  if (command === "diff") {
    const live = await liveDescription();
    const same = normalize(live) === normalize(local);
    console.log(same ? "✓ AMO already matches store/listing.md" : "✗ differs");
    if (!same) {
      console.log("\n--- live ---\n" + live + "\n\n--- local ---\n" + local);
    }
    return;
  }

  if (command === "apply") {
    await api(`/addons/addon/${ADDON_ID}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: { [LOCALE]: local } }),
    });
    const live = await liveDescription();
    if (normalize(live) !== normalize(local)) {
      throw new Error("PATCH returned OK but the live description did not change");
    }
    console.log("✓ AMO description updated and verified");
    return;
  }

  usage(`unknown command: ${command}`);
}

/** The "## AMO description" section of store/listing.md, prose only. */
function localDescription() {
  const md = readFileSync(resolve(root, "store/listing.md"), "utf8");
  const section = md.split(/^## AMO description$/m)[1];
  if (!section) throw new Error("store/listing.md has no '## AMO description' section");
  const lines = section.split("\n");
  // Drop the editorial note: it ends at the line naming this script.
  const start = lines.findIndex((l) => l.startsWith("Applied with"));
  if (start === -1) throw new Error("expected an 'Applied with' line to end the note");
  const body = lines.slice(start + 1).join("\n").trim();
  if (!body) throw new Error("no description text found after the note");
  return body;
}

async function liveDescription() {
  const json = await api(`/addons/addon/${ADDON_ID}/?lang=${LOCALE}`);
  const raw = json.description?.[LOCALE] ?? json.description ?? "";
  return String(raw).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

/** Compare ignoring whitespace-only differences AMO introduces on render. */
function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

async function api(path, init = {}) {
  const res = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { Authorization: `JWT ${jwt()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Minimal HS256 JWT — AMO requires exp <= 5 minutes after iat. */
function jwt() {
  const issuer = required("AMO_JWT_ISSUER");
  const secret = required("AMO_JWT_SECRET");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: issuer,
    jti: randomUUID(),
    iat: now - 5,
    exp: now + 240,
  })}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

function usage(msg) {
  if (msg) console.error(`✘ ${msg}\n`);
  console.log(`AMO listing description

  node scripts/publish/update-amo-listing.mjs show
  node scripts/publish/update-amo-listing.mjs diff
  node scripts/publish/update-amo-listing.mjs apply

Source of truth: store/listing.md, section "## AMO description".
Env: AMO_JWT_ISSUER AMO_JWT_SECRET`);
  process.exit(msg ? 1 : 0);
}
