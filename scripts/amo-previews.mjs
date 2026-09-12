#!/usr/bin/env node
/**
 * Replace the Firefox Add-ons (AMO) preview images with the store screenshots
 * in the repo. AMO accepts preview changes through the API independently of
 * a version review. Runs in the store-status workflow; needs the AMO key pair.
 *
 *   node scripts/amo-previews.mjs list    # print the live previews (read-only)
 *   node scripts/amo-previews.mjs apply   # delete live previews, upload store/images/screenshot-*.png in order, print the result
 *
 * Docs: https://mozilla.github.io/addons-server/topics/api/addons.html (previews)
 * Env: AMO_JWT_ISSUER AMO_JWT_SECRET
 */
import {readFileSync, readdirSync} from "node:fs";
import {basename, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHmac, randomUUID} from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(root, "store.config.json"), "utf8"));
const SLUG = config.stores.firefox.slug;
const API_ROOT = "https://addons.mozilla.org/api/v5";
const IMAGES_DIR = resolve(root, "store/images");

const CAPTIONS = {
    "screenshot-01-transcript.png": "Captions the page already has, as a searchable transcript beside the video",
    "screenshot-02-search.png": "Search the transcript and jump to a moment by its timestamp",
    "screenshot-03-export.png": "Save the transcript to a file in the format you need",
    "screenshot-04-pasted-url.png": "Paste a link: the page opens and one click on the toolbar action inspects it",
    "screenshot-05-settings.png": "Settings: everything runs in the browser, nothing leaves your machine",
};

main().catch((err) => {
    console.error(`\n✘ ${err.message}`);
    process.exit(1);
});

async function main() {
    const command = process.argv[2] ?? "help";
    if (command === "list") return printPreviews(await livePreviews());
    if (command !== "apply") {
        console.log("usage: node scripts/amo-previews.mjs list|apply");
        process.exit(command === "help" ? 0 : 1);
    }
    const files = readdirSync(IMAGES_DIR).filter((f) => /^screenshot-\d+.*\.png$/.test(f)).sort();
    if (files.length === 0) throw new Error(`no screenshot-*.png in ${IMAGES_DIR}`);
    const locale = (await addon()).default_locale ?? "en-US";

    const before = await livePreviews();
    console.log(`live before: ${before.length} preview(s)`);
    for (const preview of before) {
        await api(`/addons/addon/${SLUG}/previews/${preview.id}/`, {method: "DELETE"});
        console.log(`  deleted ${preview.id}`);
    }
    for (const [index, file] of files.entries()) {
        const form = new FormData();
        form.append("image", new Blob([readFileSync(resolve(IMAGES_DIR, file))], {type: "image/png"}), file);
        form.append("position", String(index));
        const created = await api(`/addons/addon/${SLUG}/previews/`, {method: "POST", body: form});
        const caption = CAPTIONS[file];
        if (caption) {
            await api(`/addons/addon/${SLUG}/previews/${created.id}/`, {
                method: "PATCH",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({caption: {[locale]: caption}}),
            });
        }
        console.log(`  uploaded ${file} → preview ${created.id} (position ${index})`);
    }
    const after = await livePreviews();
    if (after.length !== files.length) {
        throw new Error(`expected ${files.length} previews after apply, AMO reports ${after.length}`);
    }
    console.log("✓ previews replaced and verified");
    printPreviews(after);
}

async function addon() {
    return api(`/addons/addon/${SLUG}/`);
}

async function livePreviews() {
    const json = await addon();
    return (json.previews ?? []).map((p) => ({
        id: p.id,
        position: p.position,
        caption: typeof p.caption === "string" ? p.caption : Object.values(p.caption ?? {})[0] ?? "",
        image: p.image_url,
        size: p.image_size,
    }));
}

function printPreviews(previews) {
    for (const p of previews) {
        console.log(`  #${p.id}  position=${p.position}  ${p.size?.join("x") ?? "?"}  ${basename(String(p.image).split("?")[0])}  ${p.caption}`);
    }
    if (previews.length === 0) console.log("  (none)");
}

async function api(path, init = {}) {
    const res = await fetch(`${API_ROOT}${path}`, {
        ...init,
        headers: {Authorization: `JWT ${jwt()}`, ...(init.headers ?? {})},
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${res.status}): ${await res.text()}`);
    if (res.status === 204) return {};
    return res.json();
}

/** Minimal HS256 JWT; AMO requires exp <= 5 minutes after iat. */
function jwt() {
    const issuer = required("AMO_JWT_ISSUER");
    const secret = required("AMO_JWT_SECRET");
    const now = Math.floor(Date.now() / 1000);
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const unsigned = `${b64({alg: "HS256", typ: "JWT"})}.${b64({iss: issuer, jti: randomUUID(), iat: now - 5, exp: now + 240})}`;
    const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
    return `${unsigned}.${sig}`;
}

function required(name) {
    const v = process.env[name];
    if (!v) throw new Error(`missing required env var: ${name}`);
    return v;
}
