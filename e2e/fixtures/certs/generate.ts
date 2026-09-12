import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, statSync} from "node:fs";
import path from "node:path";

/**
 * Self-signed certificate for the local fixture server.
 *
 * Generated on first use rather than committed. A private key in the repository
 * also ends up in the AMO source archive, which `git archive` builds from every
 * tracked file, and a key whose subject is a third-party domain is a question
 * nobody reviewing this add-on should have to ask.
 *
 * The certificate is worthless outside these tests: it is self-signed, so no
 * trust store accepts it, and Playwright is the only thing that talks to it.
 */
const DIR = path.dirname(new URL(import.meta.url).pathname);
const CRT = path.join(DIR, "youtube-fixture.crt");
const KEY = path.join(DIR, "youtube-fixture.key");
const SUBJECT = "/CN=www.youtube.com";
const DAYS = 30;

function isFresh(file: string): boolean {
    if (!existsSync(file)) return false;
    const ageDays = (Date.now() - statSync(file).mtimeMs) / 86_400_000;
    return ageDays < DAYS - 1;
}

function generate(): void {
    mkdirSync(DIR, {recursive: true});
    execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", KEY,
        "-out", CRT,
        "-days", String(DAYS),
        "-subj", SUBJECT,
        "-addext", "subjectAltName=DNS:www.youtube.com",
    ], {stdio: "ignore"});
}

/** Returns the fixture certificate, generating it if missing or expiring. */
export function fixtureCertificate(): {cert: Buffer; key: Buffer} {
    if (!isFresh(CRT) || !isFresh(KEY)) generate();
    return {cert: readFileSync(CRT), key: readFileSync(KEY)};
}
