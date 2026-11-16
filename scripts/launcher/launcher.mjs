// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The npm launcher (#717): keeps verified standalone runtimes in a cache, a pointer to the one
// to run (stable by default, nightly when switched), and runs it. No dependencies.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
];
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
	const cause = redact(
		error?.cause?.code ?? error?.cause?.message ?? error?.message,
		net.secrets,
	);
	const where = net.isDefault ? "github.com" : redact(net.base, net.secrets);
	return new LauncherError(
		`couldn't reach ${where} (${cause}) for ${redact(url, net.secrets)}. Behind a proxy, set HTTPS_PROXY (npm's https-proxy is used when it is unset). Where only an internal mirror is reachable, set PRISMALENS_RELEASE_BASE_URL to a mirror of ${DEFAULT_BASE}; pl --launcher-help shows how.`,
	);
}

/** npm's proxy and CA settings stand in for unset env; read only when a download is needed. */
export function networkSettings(env = process.env, npmConfig = readNpmConfig) {
	const keys = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
	const out = {};
	const fromNpm =
		keys.some((k) => env[k]) && env.NODE_EXTRA_CA_CERTS ? {} : npmConfig();
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

function readNpmConfig() {
	const win = process.platform === "win32";
	const args = ["config", "get", "https-proxy", "proxy", "noproxy", "cafile"];
	const r = spawnSync(
		win ? "cmd.exe" : "npm",
		win ? ["/d", "/c", "npm", ...args] : args,
		{
			encoding: "utf8",
			timeout: 5000,
			windowsHide: true,
		},
	);
	const config = {};
	for (const line of (r.stdout ?? "").split(/\r?\n/)) {
		const m = /^([a-z-]+)=(.*)$/.exec(line.trim());
		if (m && m[2] && m[2] !== "null" && m[2] !== "undefined")
			config[m[1]] = m[2];
	}
	return config;
}

function applyNetwork(settings) {
	if (settings.HTTPS_PROXY) {
		if (!http.setGlobalProxyFromEnv)
			throw new LauncherError(
				`this Node ${process.version} cannot use a proxy for fetch; run with NODE_USE_ENV_PROXY=1 or upgrade Node 24`,
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

/** What a complete runtime is missing; empty when it can run. */
export function damage(dir, target) {
	return Object.values(entryOf(dir, target))
		.filter((f) => !fs.existsSync(f))
		.map((f) => path.relative(dir, f));
}

function cached(root, { version, target, sha256 }) {
	if (!fs.existsSync(root)) return null;
	for (const name of fs.readdirSync(root)) {
		const meta = readJson(path.join(root, name, ".complete"));
		if (
			meta?.version === version &&
			meta.target === target &&
			(!sha256 || meta.sha256 === sha256)
		)
			return { dir: path.join(root, name), sha256: meta.sha256 };
	}
	return null;
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

/** mkdir is the lock; a holder that died or a lock older than an hour is broken. */
async function lock(file, net) {
	for (;;) {
		try {
			fs.mkdirSync(file);
			fs.writeFileSync(path.join(file, "pid"), String(process.pid));
			return () => fs.rmSync(file, { recursive: true, force: true });
		} catch (e) {
			if (e.code !== "EEXIST") throw e;
		}
		const pid = Number(readJson(path.join(file, "pid")) ?? 0);
		const age =
			Date.now() - (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0);
		if ((pid && !alive(pid)) || age > HOUR)
			fs.rmSync(file, { recursive: true, force: true });
		else if (Date.now() > net.deadline)
			throw new LauncherError(`another prismalens has held ${file} too long`);
		else await sleep(200);
		if (net.found?.()) return null;
	}
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
	const found = cached(root, want);
	if (found) {
		const missing = damage(found.dir, want.target);
		if (!missing.length) return found;
		const moved = aside(found.dir, "damaged");
		net.log(
			`the cached ${want.version} runtime is damaged (${missing.join(", ")} missing); moved it to ${moved} and downloading it again`,
		);
	}
	fs.mkdirSync(root, { recursive: true });
	net.found = () => {
		const f = cached(root, want);
		return f && !damage(f.dir, want.target).length ? f : null;
	};
	const unlock = await lock(
		path.join(root, `.lock-${want.version}-${want.target}`),
		net,
	);
	if (!unlock) return net.found();
	try {
		const again = net.found();
		if (again) return again;
		return await install(root, want, net);
	} finally {
		unlock();
	}
}

async function install(root, { version, target, tag }, net) {
	net.ready();
	const archive = archiveName(version, target);
	const at = `${net.base}/${tag}`;
	const sums = await (await get(`${at}/SHA256SUMS`, net)).text();
	const line = sums
		.split(/\r?\n/)
		.map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(l.trim()))
		.find((m) => m && m[2] === archive);
	if (!line)
		throw new NotFound(`${archive} is not listed in ${tag}'s SHA256SUMS`);
	const staging = path.join(root, `.staging-${randomBytes(6).toString("hex")}`);
	fs.mkdirSync(staging);
	try {
		const file = path.join(staging, archive);
		const actual = await download(`${at}/${archive}`, file, net, version);
		if (actual !== line[1].toLowerCase())
			throw new LauncherError(
				`checksum mismatch for ${archive} (SHA256SUMS says ${line[1]}, the download is ${actual}); nothing was installed`,
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
		const missing = damage(staging, target);
		if (missing.length)
			throw new LauncherError(`${archive} has no ${missing.join(", ")}`);
		const sha256 = actual;
		fs.writeFileSync(
			path.join(staging, ".complete"),
			`${JSON.stringify({ version, target, tag, sha256 })}\n`,
		);
		const dir = path.join(root, `${version}-${target}-${sha256.slice(0, 16)}`);
		const old = fs.existsSync(dir) ? aside(dir, "old") : null;
		fs.renameSync(staging, dir);
		if (old) fs.rmSync(old, { recursive: true, force: true });
		return { dir, sha256 };
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

/** Keeps the runtimes the pointer names; clears staging, damaged and lock leftovers over an hour old. */
export function prune(root, target, keep, now = Date.now()) {
	const removed = [];
	if (!fs.existsSync(root)) return removed;
	const keepNames = new Set(keep.filter(Boolean).map((d) => path.basename(d)));
	for (const name of fs.readdirSync(root)) {
		const full = path.join(root, name);
		const stat = fs.statSync(full, { throwIfNoEntry: false });
		if (!stat?.isDirectory()) continue;
		const leftover = /^\.(staging|lock)-|\.(damaged|old)-\d+$/.test(name);
		const meta = leftover ? null : readJson(path.join(full, ".complete"));
		const drop = leftover
			? now - stat.mtimeMs > HOUR
			: meta?.target === target && !keepNames.has(name);
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
	// Windows refuses a rename over a file another launcher is reading or replacing; retry.
	for (let i = 0; ; i++) {
		try {
			fs.renameSync(tmp, pointerFile(root, target));
			return;
		} catch (e) {
			if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || i === 50) throw e;
			Atomics.wait(
				new Int32Array(new SharedArrayBuffer(4)),
				0,
				0,
				20 + Math.random() * 30,
			);
		}
	}
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
		want = { channel: "nightly", version, tag: `v${version}`, target };
	} else if (kind === "previous") {
		if (!pointer?.previous)
			throw new LauncherError("there is no previous runtime to switch to");
		want = pointer.previous;
	} else
		throw new LauncherError(
			`--launcher-switch takes stable, nightly or previous, not "${kind}"`,
		);
	const rt = await ensureRuntime(root, want, net);
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
	const previous = same(pointer?.current, current)
		? pointer?.previous
		: pointer?.current;
	writePointer(root, target, { current, previous: previous ?? null });
	prune(root, target, [current.dir, previous?.dir]);
	net.log(`now running ${current.channel} ${current.version}`);
	process.stdout.write(`${JSON.stringify(current)}\n`);
}

/** The runtime to run now: the pointer's nightly, else this launcher's own stable version. */
async function resolveRuntime({ root, target, own, net }) {
	const pointer = readPointer(root, target);
	let want = pointer?.current?.channel === "nightly" ? pointer.current : own;
	let rt;
	try {
		rt = await ensureRuntime(root, want, net);
	} catch (error) {
		if (!(error instanceof NotFound) || want.channel !== "nightly") throw error;
		const fallback = pointer.previous ?? own;
		net.log(
			`nightly ${want.version} is no longer on the release server (nightlies are pruned) and is not cached here. Running ${fallback.channel} ${fallback.version}, recorded as previous; pl upgrade --channel nightly moves to the newest nightly.`,
		);
		want = fallback;
		rt = await ensureRuntime(root, want, net);
	}
	const current = record(want, rt);
	if (pointer?.current?.dir !== current.dir) {
		const previous = same(pointer?.current, current)
			? pointer?.previous
			: pointer?.current;
		writePointer(root, target, { current, previous: previous ?? null });
		prune(root, target, [current.dir, previous?.dir]);
	}
	return { ...rt, current };
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
	const preload = pathToFileURL(
		path.join(path.dirname(fileURLToPath(import.meta.url)), "signals.mjs"),
	).href;
	const child = spawn(node, ["--import", preload, app, ...args], {
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
		// A group signal reaches both processes; the child's preload drops the forwarded twin.
		const sent = new Set();
		for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
			process.on(signal, () => {
				if (sent.has(signal)) return;
				sent.add(signal);
				if (child.connected) child.send({ prismalensSignal: signal });
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
		run(await resolveRuntime(ctx), ctx, argv);
	} catch (error) {
		fail(
			error instanceof LauncherError
				? error.message
				: (error?.stack ?? String(error)),
		);
	}
}
