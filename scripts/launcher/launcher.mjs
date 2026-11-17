// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The npm launcher (#717): keeps verified standalone runtimes in a cache, a pointer to the one
// to run (stable by default, nightly when switched), and runs it. No dependencies.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const ini = createRequire(import.meta.url)("./ini.cjs");

export const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
];
/** packages/@prismalens/config's LAUNCHER_STOP_MESSAGE; the app shuts down once on it. */
const STOP_MESSAGE = "prismalens:stop";
export const DEFAULT_BASE =
	"https://github.com/prismalens/prismalens/releases/download";
const HOUR = 3_600_000;

export class LauncherError extends Error {}
class NotFound extends LauncherError {}

/** `{target}` or `{error}`; musl is told apart by the C library node itself was built against. */
export function detectTarget({
	platform = process.platform,
	arch = process.arch,
	glibc = process.report?.getReport?.().header?.glibcVersionRuntime,
	lddVersion = () =>
		spawnSync("ldd", ["--version"], { encoding: "utf8", timeout: 3000 }),
} = {}) {
	const target = `${platform}-${arch}`;
	const musl =
		platform === "linux" &&
		(!glibc || /musl/i.test(`${lddVersion()?.stdout}${lddVersion()?.stderr}`));
	if (TARGETS.includes(target) && !musl) return { target };
	const what = musl ? `${target} with musl libc (Alpine)` : target;
	const hint = musl
		? "Run it on a glibc Linux (Debian, Ubuntu, Fedora; node:24-slim rather than node:24-alpine)."
		: "Run it on one of those machines, in a container (node:24-slim), or from source: https://github.com/prismalens/prismalens";
	return {
		error: `there is no PrismaLens build for ${what}. Builds exist for ${TARGETS.join(", ")}. ${hint}`,
	};
}

export function cacheRoot(env = process.env, platform = process.platform) {
	if (env.PRISMALENS_LAUNCHER_DIR)
		return path.resolve(env.PRISMALENS_LAUNCHER_DIR);
	const data =
		platform === "win32"
			? (env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"))
			: (env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"));
	return path.join(data, "prismalens", "npm");
}

// --- the release server ------------------------------------------------------------------

/** https: or file: only; credentials leave the URL for an Authorization header. */
export function parseBase(raw) {
	let url;
	try {
		url = new URL(raw || DEFAULT_BASE);
	} catch {
		throw new LauncherError(
			"PRISMALENS_RELEASE_BASE_URL is not a valid URL (its value is not shown: it may hold a password).",
		);
	}
	if (url.protocol !== "https:" && url.protocol !== "file:")
		throw new LauncherError(
			`PRISMALENS_RELEASE_BASE_URL must be an https: or file: URL, not ${url.protocol}`,
		);
	const secrets = [url.username, url.password]
		.flatMap((s) => [s, decodeURIComponent(s)])
		.filter((s) => s.length >= 3);
	const auth =
		url.username || url.password
			? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`
			: null;
	url.username = "";
	url.password = "";
	return {
		base: url.href.replace(/\/+$/, ""),
		auth,
		secrets,
		isDefault: !raw,
	};
}

export function redact(text, secrets = []) {
	let out = String(text).replace(/\/\/[^/\s@]+@/g, "//***@");
	for (const s of secrets) out = out.split(s).join("***");
	return out;
}

/** Seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(value, now = Date.now()) {
	if (!value) return null;
	if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
	const at = Date.parse(value);
	return Number.isNaN(at) ? null : Math.max(0, at - now);
}

const transient = (status) => status === 408 || status === 429 || status >= 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Follows redirects itself: https only, and the Authorization header stays on its own origin. */
async function fetchOnce(url, net) {
	let current = new URL(url);
	for (let hop = 0; hop < 6; hop++) {
		if (current.protocol !== "https:")
			throw new LauncherError(
				`${redact(url, net.secrets)} redirected to a ${current.protocol} URL; only https is followed`,
			);
		const headers = {};
		if (net.auth && current.origin === net.origin)
			headers.authorization = net.auth;
		const res = await fetch(current, {
			headers,
			redirect: "manual",
			signal: AbortSignal.timeout(Math.max(1, net.deadline - Date.now())),
		});
		if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
			await res.body?.cancel();
			current = new URL(res.headers.get("location"), current);
			continue;
		}
		return res;
	}
	throw new LauncherError(`${redact(url, net.secrets)} redirected too often`);
}

export async function get(url, net) {
	if (url.startsWith("file:")) {
		const file = fileURLToPath(url);
		if (!fs.existsSync(file))
			throw new NotFound(`${redact(url, net.secrets)} does not exist`);
		return new Response(Readable.toWeb(fs.createReadStream(file)), {
			headers: { "content-length": String(fs.statSync(file).size) },
		});
	}
	let lastError = null;
	for (let attempt = 1; ; attempt++) {
		let wait;
		try {
			const res = await fetchOnce(url, net);
			if (res.ok) return res;
			await res.body?.cancel();
			if (res.status === 404)
				throw new NotFound(`${redact(url, net.secrets)} does not exist`);
			if (!transient(res.status) || attempt === 6)
				throw new LauncherError(
					`GET ${redact(url, net.secrets)} returned HTTP ${res.status}`,
				);
			wait =
				retryAfterMs(res.headers.get("retry-after")) ??
				500 * 2 ** (attempt - 1);
			net.log(
				`${redact(url, net.secrets)} answered ${res.status}; retrying in ${(wait / 1000).toFixed(1)}s`,
			);
		} catch (error) {
			if (error instanceof LauncherError) throw error;
			lastError = error;
			if (attempt === 6 || Date.now() >= net.deadline)
				throw unreachable(url, error, net);
			wait = 500 * 2 ** (attempt - 1);
		}
		wait += Math.floor(Math.random() * 250);
		if (Date.now() + wait > net.deadline && lastError)
			throw unreachable(url, lastError, net);
		if (Date.now() + wait > net.deadline)
			throw new LauncherError(
				`gave up on ${redact(url, net.secrets)}: the download deadline passed`,
			);
		await sleep(wait);
	}
}

function unreachable(url, error, net) {
	const code = error?.cause?.code ?? "";
	const cause = redact(
		code || (error?.cause?.message ?? error?.message),
		net.secrets,
	);
	const where = net.isDefault ? "github.com" : redact(net.base, net.secrets);
	const tls = /CERT|SELF_SIGNED|UNABLE_TO_(VERIFY|GET_ISSUER)/.test(code)
		? " Its certificate is not trusted here: behind a TLS-inspecting proxy, set NODE_EXTRA_CA_CERTS to your organisation's CA file (npm's cafile is used when it is unset)."
		: "";
	return new LauncherError(
		`couldn't reach ${where} (${cause}) for ${redact(url, net.secrets)}.${tls} Behind a proxy, set HTTPS_PROXY (npm's https-proxy is used when it is unset). Where only an internal mirror is reachable, set PRISMALENS_RELEASE_BASE_URL to a mirror of ${DEFAULT_BASE}; pl --launcher-help shows how.`,
	);
}

/** npm's proxy and CA settings stand in for unset env; read only when a download is needed. */
export function networkSettings(env = process.env, npmConfig = readNpmConfig) {
	const keys = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
	const out = {};
	const fromNpm =
		keys.some((k) => env[k]) && env.NODE_EXTRA_CA_CERTS ? {} : npmConfig(env);
	const proxy =
		keys.map((k) => env[k]).find(Boolean) ??
		fromNpm["https-proxy"] ??
		fromNpm.proxy;
	if (proxy) {
		out.HTTPS_PROXY = proxy;
		out.HTTP_PROXY = proxy;
		const noProxy = env.NO_PROXY ?? env.no_proxy ?? fromNpm.noproxy;
		if (noProxy) out.NO_PROXY = noProxy;
	}
	const ca = env.NODE_EXTRA_CA_CERTS ? null : fromNpm.cafile;
	if (ca) out.NODE_EXTRA_CA_CERTS = ca;
	return out;
}

const NPM_KEYS = ["https-proxy", "proxy", "noproxy", "cafile"];

/** @npmcli/config's env-replace: ${VAR}, ${VAR?} (empty when unset), backslash escapes. */
function envReplace(value, env) {
	return value.replace(
		/(?<!\\)(\\*)\$\{([^${}?]+)(\?)?\}/g,
		(orig, esc, name, modifier) => {
			const fallback = modifier === "?" ? "" : `\${${name}}`;
			const val = env[name] !== undefined ? env[name] : fallback;
			if (esc.length % 2) return orig.slice((esc.length + 1) / 2);
			return esc.slice(esc.length / 2) + val;
		},
	);
}

/** One npmrc's values for `NPM_KEYS`, parsed with npm's own ini and its value rules; {} when unreadable. */
export function parseNpmrc(text, env = process.env) {
	const out = {};
	let parsed;
	try {
		parsed = ini.parse(text);
	} catch {
		return out;
	}
	for (const key of NPM_KEYS) {
		const raw = parsed[key];
		if (
			raw === undefined ||
			raw === null ||
			(typeof raw === "object" && !Array.isArray(raw))
		)
			continue;
		const value = (Array.isArray(raw) ? raw : [raw])
			.map((v) => envReplace(String(v), env).trim())
			.filter(Boolean)
			.join(",");
		// cafile is a path to npm: a leading ~ is the home folder, and it is resolved.
		if (value && key === "cafile")
			out[key] = path.resolve(value.replace(/^~(?=$|[/\\])/, os.homedir()));
		else if (value) out[key] = value;
	}
	return out;
}

/** npm's local prefix: the nearest folder up from `cwd` with a package.json or node_modules. */
function localPrefix(cwd) {
	for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
		if (
			fs.existsSync(path.join(dir, "package.json")) ||
			fs.existsSync(path.join(dir, "node_modules"))
		)
			return dir;
		if (path.dirname(dir) === dir) return null;
	}
}

/**
 * npm's resolution for these keys, read from its files rather than `npm config get`, which
 * npm 11.19 refuses for proxy keys as protected: npm_config_* env, then the project, user and
 * global npmrc (https://docs.npmjs.com/cli/configuring-npm/npmrc).
 */
export function readNpmConfig(
	env = process.env,
	execPath = process.execPath,
	cwd = process.cwd(),
) {
	const read = (file) => {
		try {
			return parseNpmrc(fs.readFileSync(file, "utf8"), env);
		} catch {
			return {};
		}
	};
	const lower = Object.fromEntries(
		Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]),
	);
	const prefix =
		lower.npm_config_prefix ??
		(process.platform === "win32"
			? path.dirname(execPath)
			: path.dirname(path.dirname(execPath)));
	const global = read(
		lower.npm_config_globalconfig ?? path.join(prefix, "etc", "npmrc"),
	);
	const user = read(
		lower.npm_config_userconfig ?? path.join(os.homedir(), ".npmrc"),
	);
	const projectDir = localPrefix(cwd);
	const project = projectDir ? read(path.join(projectDir, ".npmrc")) : {};
	const fromEnv = {};
	for (const key of NPM_KEYS) {
		const value = lower[`npm_config_${key.replace("-", "_")}`];
		if (value) fromEnv[key] = value;
	}
	return { ...global, ...user, ...project, ...fromEnv };
}

function applyNetwork(settings) {
	if (settings.HTTPS_PROXY) {
		if (!http.setGlobalProxyFromEnv)
			throw new LauncherError(
				`downloading through a proxy needs Node 24.14 or later (http.setGlobalProxyFromEnv); this is ${process.version}`,
			);
		http.setGlobalProxyFromEnv({ ...process.env, ...settings });
	}
	if (settings.NODE_EXTRA_CA_CERTS && tls.setDefaultCACertificates)
		tls.setDefaultCACertificates([
			...tls.getCACertificates("default"),
			fs.readFileSync(settings.NODE_EXTRA_CA_CERTS, "utf8"),
		]);
}

export function makeNet({
	env = process.env,
	log = () => {},
	deadlineMs,
} = {}) {
	const parsed = parseBase(env.PRISMALENS_RELEASE_BASE_URL);
	const ms =
		deadlineMs ??
		(Number(env.PRISMALENS_LAUNCHER_TIMEOUT_SECONDS) || 900) * 1000;
	let applied = null;
	return {
		...parsed,
		origin: parsed.base.startsWith("https:")
			? new URL(parsed.base).origin
			: null,
		deadline: Date.now() + ms,
		log,
		/** The proxy/CA settings in force, applied once before the first request. */
		ready() {
			if (!applied && !parsed.base.startsWith("file:")) {
				applied = networkSettings(env);
				applyNetwork(applied);
			}
			return applied ?? {};
		},
	};
}

// --- the cache -----------------------------------------------------------------------------

export const archiveName = (version, target) =>
	`prismalens-${version}-${target}.${target.startsWith("win32") ? "zip" : "tar.gz"}`;

export function entryOf(dir, target) {
	return {
		node: target.startsWith("win32")
			? path.join(dir, "node", "node.exe")
			: path.join(dir, "node", "bin", "node"),
		app: path.join(dir, "app", "dist", "bin", "prismalens.js"),
	};
}

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

/** Small files whose bytes are recorded at install and checked on every start. */
const CHECKED = [
	["app", "dist", "bin", "prismalens.js"],
	["app", "package.json"],
];
const SAMPLE = 64 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;

/** Names in the cache that are never runtimes: staging, locks, and what was moved aside. */
const LEFTOVER = /^\.|\.(damaged|old|tmp|stale|done)-[0-9a-f]+$/;

const sha256File = (file) =>
	createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** The node binary's first and last 64 KiB, hashed: catches a damaged header in well under a millisecond. */
function sampleFile(file) {
	const { size } = fs.statSync(file);
	const fd = fs.openSync(file, "r");
	try {
		const hash = createHash("sha256");
		for (const at of [0, Math.max(0, size - SAMPLE)]) {
			const buf = Buffer.alloc(Math.min(SAMPLE, size));
			fs.readSync(fd, buf, 0, buf.length, at);
			hash.update(buf);
		}
		return hash.digest("hex");
	} finally {
		fs.closeSync(fd);
	}
}

const nodeRel = (dir, target) => path.relative(dir, entryOf(dir, target).node);

/**
 * What `.complete` records: the node binary's size, mtime, sample and full sha256, and the
 * entry points' size and sha256. A start checks the cheap parts of the binary and hashes it
 * in full only when they differ; `--launcher-repair` and a fresh install always hash it.
 */
function fingerprint(dir, target) {
	const node = path.join(dir, nodeRel(dir, target));
	const stat = fs.statSync(node);
	const files = {
		[nodeRel(dir, target)]: {
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			sample: sampleFile(node),
			sha256: sha256File(node),
		},
	};
	for (const parts of CHECKED) {
		const rel = path.join(...parts);
		files[rel] = {
			size: fs.statSync(path.join(dir, rel)).size,
			sha256: sha256File(path.join(dir, rel)),
		};
	}
	return files;
}

/** True only for a whole install record; anything else is unverified and fetched again. */
export function completeRecord(meta, dir, target) {
	if (!meta || typeof meta !== "object") return false;
	if (typeof meta.version !== "string" || meta.target !== target) return false;
	if (typeof meta.tag !== "string" || !HEX64.test(String(meta.sha256)))
		return false;
	const files = meta.files;
	if (!files || typeof files !== "object") return false;
	const node = files[nodeRel(dir, target)];
	if (
		!node ||
		!Number.isFinite(node.size) ||
		!Number.isFinite(node.mtimeMs) ||
		!HEX64.test(String(node.sample)) ||
		!HEX64.test(String(node.sha256))
	)
		return false;
	return CHECKED.every((parts) => {
		const f = files[path.join(...parts)];
		return f && Number.isFinite(f.size) && HEX64.test(String(f.sha256));
	});
}

/** Why a runtime cannot run as installed; empty when it can. Never throws. */
export function damage(
	dir,
	target,
	meta = readJson(path.join(dir, ".complete")),
	{ full = false } = {},
) {
	try {
		const missing = Object.values(entryOf(dir, target))
			.filter((f) => !fs.existsSync(f))
			.map((f) => `${path.relative(dir, f)} missing`);
		if (missing.length) return missing;
		if (!completeRecord(meta, dir, target))
			return [
				"its install record is missing or incomplete, so it is unverified",
			];
		const problems = [];
		for (const [rel, want] of Object.entries(meta.files)) {
			const file = path.join(dir, rel);
			if (!fs.existsSync(file)) {
				problems.push(`${rel} missing`);
				continue;
			}
			const stat = fs.statSync(file);
			if (stat.size !== want.size) problems.push(`${rel} changed size`);
			else if (want.sample) {
				const cheapOk = sampleFile(file) === want.sample;
				if (!cheapOk) problems.push(`${rel} changed`);
				else if (
					(full || stat.mtimeMs !== want.mtimeMs) &&
					sha256File(file) !== want.sha256
				)
					problems.push(`${rel} changed`);
			} else if (sha256File(file) !== want.sha256)
				problems.push(`${rel} changed`);
		}
		return problems;
	} catch (error) {
		return [`its files could not be read (${error.code ?? error.message})`];
	}
}

/** The cached runtimes for `want`: a pinned digest, else a digest verified before, must match. */
function cachedAll(root, { version, target, sha256, pinned }) {
	if (!fs.existsSync(root)) return [];
	const digest = pinned ?? sha256;
	const found = [];
	for (const name of fs.readdirSync(root)) {
		if (LEFTOVER.test(name)) continue;
		const meta = readJson(path.join(root, name, ".complete"));
		if (
			meta?.version === version &&
			meta.target === target &&
			(!digest || meta.sha256 === digest)
		)
			found.push({ dir: path.join(root, name), sha256: meta.sha256, meta });
	}
	return found;
}

function aside(dir, why) {
	const to = `${dir}.${why}-${Date.now()}`;
	fs.renameSync(dir, to);
	return to;
}

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === "EPERM";
	}
};

// --- owners: who holds a lock or a lease ---------------------------------------------------

/** This machine's boot: Linux's boot id, elsewhere the boot time to the minute. */
const BOOT = (() => {
	try {
		return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
	} catch {
		return String(Math.round((Date.now() - os.uptime() * 1000) / 60_000));
	}
})();
const HEARTBEAT_MS = 10_000;
const STALE_MS = 45_000;

/** What a lock or lease records about its holder: machine, boot, pid, start time, a token. */
export function ownerRecord(token = randomBytes(8).toString("hex")) {
	return {
		host: os.hostname(),
		boot: BOOT,
		pid: process.pid,
		start: Math.round(performance.timeOrigin),
		token,
	};
}

/**
 * Whether the holder recorded in `record` still holds, given when it last beat. Every holder
 * refreshes its file's mtime while it lives, so a pid the system reused, or a holder on another
 * machine that stopped, reads as gone once its heartbeat is a minute old (#717).
 */
export function holds(record, mtimeMs, now = Date.now()) {
	const fresh = now - mtimeMs < STALE_MS;
	if (!record || typeof record !== "object") return false;
	if (record.host === os.hostname() && record.boot === BOOT)
		return fresh && alive(Number(record.pid));
	return fresh;
}

/** Touches `file` while this process lives and `owns()`; returns a stop. */
function heartbeat(file, owns = () => true) {
	const timer = setInterval(() => {
		// A holder that lost its lock never refreshes the next holder's record.
		if (!owns()) return clearInterval(timer);
		try {
			const now = new Date();
			fs.utimesSync(file, now, now);
		} catch {}
	}, HEARTBEAT_MS);
	timer.unref();
	return () => clearInterval(timer);
}

const pause = (ms) =>
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Windows refuses to replace or delete a file while another process reads it, as launchers
 * reading the pointer or an owner record do; it retries.
 */
function retrying(op) {
	for (let i = 0; ; i++) {
		try {
			return op();
		} catch (e) {
			if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || i === 50) throw e;
			pause(20 + Math.random() * 30);
		}
	}
}

const renameRetrying = (from, to) => retrying(() => fs.renameSync(from, to));

/** When `file` last changed; null while it cannot be read, as when Windows is deleting it. */
const mtimeOf = (file) => {
	try {
		return fs.statSync(file).mtimeMs;
	} catch {
		return null;
	}
};

/**
 * Takes `file` if no one holds it: a directory renamed into place with one entry, named by this
 * holder's token and holding its owner record. Returns the token, or null while someone holds it.
 */
export function tryLock(file) {
	const owner = ownerRecord();
	const tmp = `${file}.tmp-${owner.token}`;
	fs.mkdirSync(tmp);
	fs.writeFileSync(path.join(tmp, owner.token), JSON.stringify(owner));
	try {
		fs.renameSync(tmp, file);
		return owner.token;
	} catch (e) {
		fs.rmSync(tmp, { recursive: true, force: true });
		if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES", "EBUSY"].includes(e.code))
			throw e;
		return null;
	}
}

/**
 * A lock no one else holds; a holder that stopped, by its owner record and heartbeat, is broken.
 * Resolves to an unlock function whose `owns()` says whether this holder still holds it, or to
 * null once `found()` says the work is done.
 */
export async function lock(file, net, found = () => null) {
	for (;;) {
		const token = tryLock(file);
		if (token) {
			const entry = path.join(file, token);
			const owns = () => fs.existsSync(entry);
			const stop = heartbeat(entry, owns);
			const unlock = () => {
				stop();
				releaseLock(file, token);
			};
			unlock.owns = owns;
			return unlock;
		}
		const held = lockHolder(file);
		if (held.stale) breakLock(file, held.token);
		else if (Date.now() > net.deadline)
			throw new LauncherError(`another prismalens has held ${file} too long`);
		else await sleep(200);
		if (found()) return null;
	}
}

/**
 * Who holds `file` (its one entry's name), and whether that holder is gone. No lock has no
 * holder; an empty one is left between a removal's two steps and is free to clear.
 */
export function lockHolder(file) {
	let names;
	try {
		names = fs.readdirSync(file);
	} catch {
		return { token: null, stale: false };
	}
	if (!names.length) return { token: null, stale: true };
	const entry = path.join(file, names[0]);
	const record = readJson(entry);
	const mtime = mtimeOf(entry);
	if (mtime === null) return { token: names[0], stale: false };
	return {
		token: names[0],
		stale: record ? !holds(record, mtime) : Date.now() - mtime > 60_000,
	};
}

/**
 * Removes `token`'s entry, then the lock only if that left it empty. Nothing is renamed and no
 * other holder's entry is touched, so a holder that resumes late cannot disturb a lock taken
 * after its own was broken (#717). True when the entry was there.
 */
function removeEntry(file, token) {
	let removed = false;
	try {
		retrying(() => fs.unlinkSync(path.join(file, token)));
		removed = true;
	} catch (e) {
		if (e.code !== "ENOENT") return false;
	}
	try {
		fs.rmdirSync(file);
	} catch {}
	return removed;
}

/** Breaks the lock seen with `token` if it still carries that token and its holder is gone. */
export function breakLock(file, token) {
	const held = lockHolder(file);
	if (held.token !== token || !held.stale) return false;
	if (token !== null) return removeEntry(file, token);
	try {
		fs.rmdirSync(file);
		return true;
	} catch {
		return false;
	}
}

/** Gives up `file` if it still holds this acquisition's entry. */
export function releaseLock(file, token) {
	return removeEntry(file, token);
}

async function download(url, file, net, label) {
	const res = await get(url, net);
	const total = Number(res.headers.get("content-length")) || 0;
	const hash = createHash("sha256");
	const out = fs.openSync(file, "w");
	const tty = process.stderr.isTTY;
	let received = 0;
	let shown = -1;
	try {
		for await (const chunk of res.body) {
			hash.update(chunk);
			fs.writeSync(out, chunk);
			received += chunk.byteLength;
			const pct = total ? Math.floor((received * 100) / total) : -1;
			if (tty && pct !== shown) {
				shown = pct;
				process.stderr.write(
					`\r\x1b[2Kprismalens: downloading ${label}${total ? ` ${pct}%` : ""} (${(received / 1048576).toFixed(1)} MB)`,
				);
			}
		}
	} finally {
		fs.closeSync(out);
		if (tty) process.stderr.write("\r\x1b[2K");
	}
	return hash.digest("hex");
}

/**
 * A verified runtime for `want` in the cache, downloaded once even when several launchers
 * start together: the lock holder downloads, the others wait and find its result (#717).
 */
export async function ensureRuntime(root, want, net) {
	const ready = () =>
		cachedAll(root, want).find(
			(f) => !damage(f.dir, want.target, f.meta).length,
		) ?? null;
	const found = ready();
	if (found) return found;
	fs.mkdirSync(root, { recursive: true });
	const unlock = await lock(
		path.join(root, `.lock-${want.version}-${want.target}`),
		net,
		ready,
	);
	if (!unlock) return ready();
	try {
		const again = ready();
		if (again) return again;
		for (const broken of cachedAll(root, want)) {
			const problems = damage(broken.dir, want.target, broken.meta).join(", ");
			// A runtime a live process still runs is left in place; a fresh copy goes beside it.
			if (leased(broken.dir))
				net.log(
					`the cached ${want.version} runtime is damaged (${problems}), and a running PrismaLens still uses it; downloading a fresh copy beside it`,
				);
			else
				net.log(
					`the cached ${want.version} runtime is damaged (${problems}); moved it to ${aside(broken.dir, "damaged")} and downloading it again`,
				);
		}
		return await install(root, want, net);
	} finally {
		unlock();
	}
}

/**
 * The digest the archive must have: the one npm's launcher manifest pins for its own stable
 * release, else the release's SHA256SUMS line, which must match a digest this copy verified before.
 */
async function expectedDigest(want, net, at, archive) {
	if (want.pinned)
		return { hex: want.pinned, source: "the digest npm's launcher pins" };
	const sums = await (await get(`${at}/SHA256SUMS`, net)).text();
	const line = sums
		.split(/\r?\n/)
		.map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(l.trim()))
		.find((m) => m && m[2] === archive);
	if (!line)
		throw new NotFound(`${archive} is not listed in ${want.tag}'s SHA256SUMS`);
	const hex = line[1].toLowerCase();
	if (want.sha256 && hex !== want.sha256)
		throw new LauncherError(
			`${want.tag}'s SHA256SUMS now lists ${archive} as ${hex}, but this copy verified ${want.version} for ${want.target} as ${want.sha256}; nothing was installed`,
		);
	return { hex, source: "SHA256SUMS" };
}

async function install(root, want, net) {
	const { version, target, tag } = want;
	net.ready();
	const archive = archiveName(version, target);
	const at = `${net.base}/${tag}`;
	const expected = await expectedDigest(want, net, at, archive);
	const staging = path.join(root, `.staging-${randomBytes(6).toString("hex")}`);
	fs.mkdirSync(staging);
	try {
		const file = path.join(staging, archive);
		const actual = await download(`${at}/${archive}`, file, net, version);
		if (actual !== expected.hex)
			throw new LauncherError(
				`checksum mismatch for ${archive} (${expected.source} says ${expected.hex}, the download is ${actual}); nothing was installed`,
			);
		// Windows' own bsdtar reads zip; a Git-for-Windows tar on PATH cannot.
		const tar = target.startsWith("win32")
			? path.join(
					process.env.SystemRoot ?? "C:\\Windows",
					"System32",
					"tar.exe",
				)
			: "tar";
		const x = spawnSync(tar, ["-xf", archive, "--strip-components=1"], {
			cwd: staging,
			stdio: ["ignore", "ignore", "inherit"],
			windowsHide: true,
		});
		fs.rmSync(file, { force: true });
		if (x.status !== 0) throw new LauncherError(`could not extract ${archive}`);
		const missing = Object.values(entryOf(staging, target))
			.filter((f) => !fs.existsSync(f))
			.map((f) => path.relative(staging, f));
		if (missing.length)
			throw new LauncherError(`${archive} has no ${missing.join(", ")}`);
		const sha256 = actual;
		const files = fingerprint(staging, target);
		fs.writeFileSync(
			path.join(staging, ".complete"),
			`${JSON.stringify({ version, target, tag, sha256, files })}\n`,
		);
		// A new name for every install, so a fresh copy never replaces one a process still runs.
		const dir = path.join(
			root,
			`${version}-${target}-${sha256.slice(0, 16)}-${randomBytes(3).toString("hex")}`,
		);
		// Leased before it is visible, so no prune removes it before its pointer moves.
		lease(staging, dir);
		fs.renameSync(staging, dir);
		return { dir, sha256 };
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * This process's claim on a runtime: an owner record in `.leases/`, beating while it lives and
 * removed when it exits. Written into `at` (a staging dir about to become `dir`) or `dir`.
 */
function lease(at, dir = at) {
	const owner = ownerRecord();
	const name = `${owner.pid}-${owner.token}`;
	try {
		fs.mkdirSync(path.join(at, ".leases"), { recursive: true });
		fs.writeFileSync(path.join(at, ".leases", name), JSON.stringify(owner));
	} catch {
		// A read-only cache cannot be leased, and this launcher cannot prune it either.
		return;
	}
	const file = path.join(dir, ".leases", name);
	const stop = heartbeat(file);
	process.on("exit", () => {
		stop();
		try {
			fs.rmSync(file, { force: true });
		} catch {}
	});
}

/** True while a holder of a lease on `dir` still holds it. */
function leased(dir) {
	const leases = path.join(dir, ".leases");
	if (!fs.existsSync(leases)) return false;
	return fs.readdirSync(leases).some((name) => {
		const file = path.join(leases, name);
		const mtime = mtimeOf(file) ?? Date.now();
		return holds(readJson(file), mtime);
	});
}

/**
 * Removes this target's runtimes the pointer does not name, and leftovers (staging, locks,
 * runtimes moved aside) over an hour old, but never anything a live process leased.
 * Called under the pointer lock, which every claim on a runtime also takes.
 */
export function prune(root, target, keep, now = Date.now()) {
	const removed = [];
	if (!fs.existsSync(root)) return removed;
	const keepNames = new Set(keep.filter(Boolean).map((d) => path.basename(d)));
	for (const name of fs.readdirSync(root)) {
		const full = path.join(root, name);
		const stat = fs.statSync(full, { throwIfNoEntry: false });
		if (!stat?.isDirectory() || keepNames.has(name) || leased(full)) continue;
		// A lock is broken by its gone holder's entry, never removed whole: one taken meanwhile stays.
		if (name.startsWith(".lock-") && !/\.tmp-[0-9a-f]+$/.test(name)) {
			if (name.startsWith(".lock-pointer") || now - stat.mtimeMs <= HOUR)
				continue;
			const held = lockHolder(full);
			if (held.stale && breakLock(full, held.token)) removed.push(name);
			continue;
		}
		const drop = LEFTOVER.test(name)
			? now - stat.mtimeMs > HOUR
			: readJson(path.join(full, ".complete"))?.target === target;
		if (!drop) continue;
		try {
			fs.rmSync(full, { recursive: true, force: true });
			removed.push(name);
		} catch {
			// A runtime still running on Windows cannot be removed; the next prune retries.
		}
	}
	return removed;
}

// --- the pointer -----------------------------------------------------------------------------

export const pointerFile = (root, target) =>
	path.join(root, `active-${target}.json`);

export function readPointer(root, target) {
	const p = readJson(pointerFile(root, target));
	return p?.current?.version ? p : null;
}

/** Written whole and renamed into place, so a reader sees the old pointer or the new one. */
export function writePointer(root, target, pointer) {
	fs.mkdirSync(root, { recursive: true });
	const tmp = `${pointerFile(root, target)}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(pointer, null, 2)}\n`);
	renameRetrying(tmp, pointerFile(root, target));
}

const record = (want, rt) => ({
	channel: want.channel,
	version: want.version,
	tag: want.tag,
	target: want.target,
	sha256: rt.sha256,
	dir: path.basename(rt.dir),
});

const same = (a, b) =>
	a && b && a.version === b.version && a.channel === b.channel;

/**
 * Under the pointer lock: claims `rt` (still complete and whole, then leased), and with
 * `change` reads, changes and writes the pointer and prunes to what it names. Every prune
 * runs under this lock, so a claimed runtime cannot be removed before its pointer moves.
 * False when `rt` vanished or broke since it was found; the caller looks again.
 */
async function claim(root, target, net, rt, change = () => null) {
	fs.mkdirSync(root, { recursive: true });
	const unlock = await lock(path.join(root, `.lock-pointer-${target}`), net);
	try {
		const meta = readJson(path.join(rt.dir, ".complete"));
		if (!meta || damage(rt.dir, target, meta).length) return false;
		lease(rt.dir);
		const next = change(readPointer(root, target), rt);
		if (next && !unlock.owns())
			throw new LauncherError(
				`this launch stalled long enough to lose ${root}'s pointer lock; nothing was changed. Run pl again`,
			);
		if (next) {
			writePointer(root, target, next);
			prune(root, target, [next.current?.dir, next.previous?.dir]);
		}
		return true;
	} finally {
		unlock();
	}
}

/** ensureRuntime, then claim; a runtime pruned or damaged in between is fetched again. */
async function ensureClaimed(root, want, net, change) {
	for (let attempt = 0; ; attempt++) {
		const rt = await ensureRuntime(root, want, net);
		if (await claim(root, want.target, net, rt, change)) return rt;
		if (attempt === 2)
			throw new LauncherError(
				`the ${want.version} runtime kept disappearing from ${root}; is something else cleaning it?`,
			);
	}
}

// --- migrations ------------------------------------------------------------------------------

const SCHEMA = [
	"app",
	"node_modules",
	"@prismalens",
	"database",
	"dist",
	"prisma",
	"sqlite",
	"schema",
];

/** The applied migrations a runtime does not ship: what its migration runner refuses on. */
export async function migrationSkew(runtimeDir, dbFile) {
	if (!fs.existsSync(dbFile)) return [];
	const schema = path.join(runtimeDir, ...SCHEMA);
	if (!fs.existsSync(schema))
		throw new LauncherError(
			`can't read the migrations ${runtimeDir} ships (no ${SCHEMA.join("/")}); nothing was changed`,
		);
	const shipped = new Set(
		fs
			.readdirSync(schema)
			.filter((n) => fs.existsSync(path.join(schema, n, "migration.sql"))),
	);
	const { DatabaseSync } = await import("node:sqlite");
	const db = new DatabaseSync(dbFile, { readOnly: true });
	try {
		const table = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'",
			)
			.get();
		if (!table) return [];
		return db
			.prepare(
				"SELECT migration_name AS name FROM _prisma_migrations WHERE rolled_back_at IS NULL",
			)
			.all()
			.map((r) => r.name)
			.filter((n) => !shipped.has(n))
			.sort();
	} finally {
		db.close();
	}
}

export function skewMessage(dbFile, want, skew, current) {
	return `${dbFile} records ${skew.length === 1 ? "a migration" : "migrations"} PrismaLens ${want.version} does not ship (${skew.join(", ")}). Switching would leave pl up refusing to start ("migrations this build does not ship"). Nothing was changed: this copy stays on ${current ? `${current.channel} ${current.version}` : "its current version"}. To go to ${want.version} anyway, restore the prismalens.db.bak-* file made before those migrations, then switch again.`;
}

// --- commands ------------------------------------------------------------------------------

export function help(release, root, target) {
	return `PrismaLens launcher ${release.version}

pl from npm is a launcher. On first run it downloads PrismaLens ${release.version} for
${target} from its GitHub release, checks it against the release's SHA256SUMS,
keeps it in ${root}, and runs it. Later runs start from that copy offline.

npm carries stable releases. Inside the app, pl upgrade --channel nightly moves this
copy to the newest nightly and pl upgrade --channel stable moves it back; the
switch refuses when the workspace database is newer than the target.

Commands
  pl --launcher-help     This text.
  pl --launcher-repair   Move the runtime in use aside and download it again. A runtime
                         whose entry points changed since it was installed is repaired
                         this way on its own at the next start.

Environment
  PRISMALENS_RELEASE_BASE_URL  Where releases come from, as <base>/v<version>/<file>;
                               https: or file: only. Default:
                               ${DEFAULT_BASE}
                               https://user:token@host/... sends an Authorization header;
                               the credentials are never printed.
  PRISMALENS_LAUNCHER_DIR      Where runtimes are kept. Default: ${root}
  PRISMALENS_LAUNCHER_TIMEOUT_SECONDS
                               How long a download may take, retries included. Default: 900
  HTTPS_PROXY, NO_PROXY        Proxy for the download; npm's https-proxy, proxy and
                               noproxy are used when these are unset.
  NODE_EXTRA_CA_CERTS          Extra CA certificates; npm's cafile when unset.

Behind Artifactory, Nexus or another registry proxy
  1. Create a generic remote repository whose URL is
     ${DEFAULT_BASE}
  2. Set PRISMALENS_RELEASE_BASE_URL=https://<host>/artifactory/<that-repository>
  3. Run pl again: it fetches <base>/v${release.version}/SHA256SUMS and
     <base>/v${release.version}/${archiveName(release.version, target)}.

Offline
  Copy SHA256SUMS and ${archiveName(release.version, target)} from
  https://github.com/prismalens/prismalens/releases/tag/v${release.version} into
  <folder>/v${release.version}/ and set PRISMALENS_RELEASE_BASE_URL=file:///<folder>.
`;
}

function option(argv, name) {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
}

/** `--launcher-switch stable|nightly|previous`: verify first, flip the pointer last. */
async function switchTo(argv, ctx) {
	const { root, target, own, net } = ctx;
	const kind = option(argv, "--launcher-switch");
	const pointer = readPointer(root, target);
	let want;
	if (kind === "stable") want = own;
	else if (kind === "nightly") {
		const version = option(argv, "--version");
		if (!version?.includes("-nightly."))
			throw new LauncherError(
				"--launcher-switch nightly needs --version <nightly version>",
			);
		// A nightly this copy verified before must keep the digest it was verified with.
		const known = [pointer?.current, pointer?.previous].find(
			(r) => r?.channel === "nightly" && r.version === version,
		);
		want = {
			channel: "nightly",
			version,
			tag: `v${version}`,
			target,
			sha256: known?.sha256,
		};
	} else if (kind === "previous") {
		if (!pointer?.previous)
			throw new LauncherError("there is no previous runtime to switch to");
		want = pointer.previous;
		// A stable runtime is this launcher's own version; another one comes from npm.
		if (want.channel === "stable" && want.version !== own.version)
			throw new LauncherError(
				`the previous runtime is stable ${want.version}, but this launcher runs stable ${own.version}; install that launcher with npm install -g prismalens@${want.version}, then run pl again`,
			);
	} else
		throw new LauncherError(
			`--launcher-switch takes stable, nightly or previous, not "${kind}"`,
		);
	const rt = await ensureRuntime(root, want, net);
	if (!(await claim(root, target, net, rt)))
		throw new LauncherError(
			`the ${want.version} runtime changed while switching; run the switch again`,
		);
	const workspace = option(argv, "--workspace");
	if (workspace) {
		const dbFile = path.join(workspace, "prismalens.db");
		const skew = await migrationSkew(rt.dir, dbFile);
		if (skew.length)
			throw new LauncherError(
				skewMessage(dbFile, want, skew, pointer?.current),
			);
	}
	const current = record(want, rt);
	await claim(root, target, net, rt, (now) => ({
		current,
		previous:
			(same(now?.current, current) ? now?.previous : now?.current) ?? null,
	}));
	net.log(`now running ${current.channel} ${current.version}`);
	process.stdout.write(`${JSON.stringify(current)}\n`);
}

/**
 * The runtime to run now: the pointer's nightly, else this launcher's own stable version.
 * A nightly that is gone runs the recorded previous this once and leaves the pointer alone;
 * the app's migration runner still refuses a database newer than that runtime.
 */
async function resolveRuntime({ root, target, own, net }) {
	for (let attempt = 0; ; attempt++) {
		const pointer = readPointer(root, target);
		const want =
			pointer?.current?.channel === "nightly" ? pointer.current : own;
		let moved = false;
		try {
			const rt = await ensureClaimed(root, want, net, (now, claimed) => {
				// A switch that landed while this launch waited wins; this launch looks again.
				if (
					JSON.stringify(now?.current ?? null) !==
					JSON.stringify(pointer?.current ?? null)
				) {
					moved = true;
					return null;
				}
				const current = record(want, claimed);
				return now?.current?.dir === current.dir
					? null
					: {
							current,
							previous:
								(same(now?.current, current) ? now?.previous : now?.current) ??
								null,
						};
			});
			if (moved && attempt < 3) continue;
			if (moved)
				throw new LauncherError(
					`the runtime pointer in ${root} changed on each of ${attempt + 1} tries while this launch waited; nothing was started. Run pl again`,
				);
			return { ...rt, current: record(want, rt) };
		} catch (error) {
			if (!(error instanceof NotFound) || want.channel !== "nightly")
				throw error;
			const fallback = pointer.previous ?? own;
			net.log(
				`nightly ${want.version} is no longer on the release server (nightlies are pruned) and is not cached here. Running ${fallback.channel} ${fallback.version}, recorded as previous, this once; if the nightly migrated this workspace, pl up refuses to start it and says how to restore. pl upgrade --channel nightly moves to the newest nightly, --channel stable stays on stable.`,
			);
			const rt = await ensureClaimed(root, fallback, net);
			return { ...rt, current: record(fallback, rt) };
		}
	}
}

/**
 * `--launcher-repair`: downloads and verifies a fresh copy of the runtime the pointer names,
 * points at it, then moves the old one aside unless a running PrismaLens still uses it
 * (install aside, then swap). Offline or on a bad download nothing changes.
 */
async function repair({ root, target, own, net }) {
	const pointer = readPointer(root, target);
	const want = pointer?.current?.channel === "nightly" ? pointer.current : own;
	const old = cachedAll(root, want);
	for (const f of old) {
		const problems = damage(f.dir, target, f.meta, { full: true });
		net.log(
			`checked ${f.dir}: ${problems.length ? problems.join(", ") : "whole"}`,
		);
	}
	fs.mkdirSync(root, { recursive: true });
	const unlock = await lock(
		path.join(root, `.lock-${want.version}-${want.target}`),
		net,
	);
	let rt;
	try {
		rt = await install(root, want, net);
	} finally {
		unlock();
	}
	const current = record(want, rt);
	await claim(root, target, net, rt, (now) =>
		now?.current?.dir === current.dir
			? null
			: {
					current,
					previous:
						(same(now?.current, current) ? now?.previous : now?.current) ??
						null,
				},
	);
	for (const f of old) {
		if (!fs.existsSync(f.dir)) net.log(`removed ${f.dir}`);
		else if (leased(f.dir))
			net.log(
				`kept ${f.dir}: a running PrismaLens still uses it; it goes once that stops`,
			);
		else net.log(`moved ${aside(f.dir, "damaged")} aside`);
	}
	net.log(`repaired ${want.channel} ${want.version} in ${rt.dir}`);
}

function run(rt, ctx, args) {
	const { node, app } = entryOf(rt.dir, ctx.target);
	const env = {
		...process.env,
		PRISMALENS_LAUNCHER: path.resolve(process.argv[1]),
		PRISMALENS_LAUNCHER_NODE: process.execPath,
		PRISMALENS_LAUNCHER_VERSION: ctx.own.version,
		PRISMALENS_RUNTIME_CHANNEL: rt.current.channel,
	};
	// The archive's own bin scripts say "installer"; through npm the channel is npm.
	delete env.PRISMALENS_INSTALL;
	const child = spawn(node, [app, ...args], {
		stdio: ["inherit", "inherit", "inherit", "ipc"],
		env,
		windowsHide: true,
	});
	// A supervisor that started this launcher (the desktop app) talks to the runtime through it.
	if (process.send) {
		process.on("message", (m) => child.connected && child.send(m));
		child.on("message", (m) => process.connected && process.send(m));
		process.on("disconnect", () => child.connected && child.disconnect());
	}
	if (process.platform === "win32") {
		// The console delivers Ctrl-C and Ctrl-Break to the child itself; stay up until it exits.
		for (const signal of ["SIGINT", "SIGBREAK"]) process.on(signal, () => {});
	} else {
		// A stop request, not a signal: the app starts one graceful shutdown whether the
		// signal reached it too (a group or cgroup stop) or only this launcher.
		let asked = false;
		for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
			process.on(signal, () => {
				if (asked) return;
				asked = true;
				if (child.connected) child.send(STOP_MESSAGE);
				else child.kill(signal);
			});
	}
	child.on("error", (e) => fail(`could not run ${node}: ${e.message}`));
	child.on("exit", (code, signal) =>
		process.exit(code ?? 128 + (os.constants.signals[signal] ?? 1)),
	);
}

let secrets = [];
function fail(message) {
	process.stderr.write(`prismalens: ${redact(message, secrets)}\n`);
	process.exit(1);
}

export async function main(argv = process.argv.slice(2)) {
	try {
		const { release } = JSON.parse(
			fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		).prismalens;
		const detected = detectTarget();
		if (detected.error) throw new LauncherError(detected.error);
		const { target } = detected;
		const root = cacheRoot();
		const net = makeNet({
			log: (m) => process.stderr.write(`prismalens: ${redact(m, secrets)}\n`),
		});
		secrets = net.secrets;
		const own = {
			channel: "stable",
			version: release.version,
			tag: release.tag,
			target,
			pinned: release.sha256?.[target],
		};
		const ctx = { root, target, own, net };
		if (argv[0] === "--launcher-help") {
			process.stdout.write(help(release, root, target));
			return;
		}
		if (argv[0] === "--launcher-switch") {
			await switchTo(argv, ctx);
			return;
		}
		if (argv[0] === "--launcher-repair") {
			await repair(ctx);
			return;
		}
		run(await resolveRuntime(ctx), ctx, argv);
	} catch (error) {
		fail(
			error instanceof LauncherError
				? error.message
				: (error?.stack ?? String(error)),
		);
	}
}
