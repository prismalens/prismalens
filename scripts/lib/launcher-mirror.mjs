// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What the release proofs install (#717): the packed launcher, plus this runner's standalone
// archive of each version in a release-shaped mirror (<root>/v<version>/{archive,SHA256SUMS})
// that the launcher reads through PRISMALENS_RELEASE_BASE_URL.
//   node scripts/lib/launcher-mirror.mjs --tarball <app.tgz> --out <dir> --release <v>[:launcher]...
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WIN = process.platform === "win32";

export const ownTarget = (platform = process.platform, arch = process.arch) =>
	`${platform}-${arch}`;

export const archiveFile = (version, target = ownTarget()) =>
	`prismalens-${version}-${target}.${target.startsWith("win32") ? "zip" : "tar.gz"}`;

const sha256 = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

/** Relative names from the archive's folder, so a Windows drive letter never reads as a tar host. */
const tarIn = (file, args) =>
	execFileSync("tar", [...args.slice(0, 1), basename(file), ...args.slice(1)], {
		cwd: dirname(file),
		encoding: "utf8",
	});

/** Extracts a copy beside `cwd`: no path to it can read as a tar host (C:) or cross a symlink (/var). */
function extractCopy(tgz, cwd, members = []) {
	const copy = join(cwd, basename(tgz));
	copyFileSync(tgz, copy);
	try {
		execFileSync("tar", ["-xzf", basename(tgz), ...members], { cwd });
	} finally {
		rmSync(copy, { force: true });
	}
}

export const tarballVersion = (tgz) =>
	JSON.parse(tarIn(tgz, ["-xzOf", "package/package.json"])).version;

function npm(args, cwd) {
	return execFileSync(
		WIN ? "cmd.exe" : "npm",
		WIN ? ["/d", "/c", "npm", ...args] : args,
		{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
	);
}

/** A copy of the app tarball under another version: the same bytes an archive of that release holds. */
export function retagTarball(tgz, version, dir) {
	const work = mkdtempSync(join(dir, "retag-"));
	extractCopy(tgz, work);
	const manifest = join(work, "package", "package.json");
	const pkg = JSON.parse(readFileSync(manifest, "utf8"));
	pkg.version = version;
	writeFileSync(manifest, JSON.stringify(pkg, null, 2));
	const out = npm(
		["pack", "--pack-destination", dir, "--loglevel=warn"],
		join(work, "package"),
	);
	rmSync(work, { recursive: true, force: true });
	return join(dir, out.trim().split("\n").at(-1).trim());
}

/** scripts/build-standalone.mjs for this runner's target, kept per tarball digest across runs. */
export function buildArchive(tgz) {
	const version = tarballVersion(tgz);
	const cache = join(
		tmpdir(),
		"pl-archive-cache",
		`${sha256(tgz).slice(0, 16)}-${ownTarget()}`,
	);
	const archive = join(cache, archiveFile(version));
	if (existsSync(archive)) return archive;
	const staging = `${cache}.building-${process.pid}`;
	rmSync(staging, { recursive: true, force: true });
	execFileSync(
		process.execPath,
		[
			join(ROOT, "scripts", "build-standalone.mjs"),
			"--tarball",
			tgz,
			"--out",
			staging,
		],
		{ cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
	);
	mkdirSync(cache, { recursive: true });
	copyFileSync(join(staging, archiveFile(version)), archive);
	rmSync(staging, { recursive: true, force: true });
	return archive;
}

/** Where an app ships the migrations the launcher's switch compares a database against (#717). */
const SCHEMA = "node_modules/@prismalens/database/dist/prisma/sqlite/schema";

/**
 * An archive in the release layout whose app is `app` (a script's source) on this machine's node:
 * a release that misbehaves on purpose, as a real archive cannot be made to. `schemaFrom`, an app
 * tarball, gives it that tarball's migrations, so only its own behaviour can fail it.
 */
export function fakeArchive({ version, app, outDir, schemaFrom }) {
	const top = `prismalens-${version}-${ownTarget()}`;
	const stage = mkdtempSync(join(outDir, "fake-"));
	const bin = join(stage, top, "app", "dist", "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, "prismalens.js"), app);
	writeFileSync(
		join(stage, top, "app", "package.json"),
		JSON.stringify({ name: "prismalens", version, type: "module" }),
	);
	if (schemaFrom) {
		const unpack = mkdtempSync(join(outDir, "schema-"));
		extractCopy(schemaFrom, unpack, [`package/${SCHEMA}`]);
		cpSync(join(unpack, "package", SCHEMA), join(stage, top, "app", SCHEMA), {
			recursive: true,
		});
		rmSync(unpack, { recursive: true, force: true });
	}
	const node = WIN
		? join(stage, top, "node", "node.exe")
		: join(stage, top, "node", "bin", "node");
	mkdirSync(dirname(node), { recursive: true });
	copyFileSync(process.execPath, node);
	if (!WIN) chmodSync(node, 0o755);
	const archive = join(outDir, archiveFile(version));
	const tar = WIN
		? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
		: "tar";
	execFileSync(tar, [WIN ? "-a" : "-z", "-cf", archive, top], { cwd: stage });
	rmSync(stage, { recursive: true, force: true });
	return archive;
}

/** SHA256SUMS lines, keyed by file name; a later write of a name replaces its line. */
export function mergeSums(text, name, digest) {
	const lines = new Map();
	for (const line of (text ?? "").split(/\r?\n/)) {
		const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
		if (m) lines.set(m[2], m[1].toLowerCase());
	}
	lines.set(name, digest);
	return [...lines]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([n, d]) => `${d}  ${n}\n`)
		.join("");
}

export function publishToMirror(root, archive, version) {
	const dir = join(root, `v${version}`);
	mkdirSync(dir, { recursive: true });
	const name = basename(archive);
	copyFileSync(archive, join(dir, name));
	const sums = join(dir, "SHA256SUMS");
	const before = existsSync(sums) ? readFileSync(sums, "utf8") : "";
	writeFileSync(sums, mergeSums(before, name, sha256(archive)));
}

export const RELEASES_URL =
	"https://github.com/prismalens/prismalens/releases/download";

/**
 * A published launcher fetches its own release's archive and refuses any other digest, so the
 * mirror must carry that exact archive, not one built here (#1154).
 * @param {string} root the mirror
 * @param {{ version: string, sha256: Record<string, string> }} release a published launcher's pins
 */
export async function mirrorPublished(
	root,
	{ version, sha256 },
	{
		base = RELEASES_URL,
		fetchImpl = fetch,
		target = ownTarget(),
		tries = 3,
	} = {},
) {
	const name = archiveFile(version, target);
	const pinned = sha256[target];
	if (!pinned)
		throw new Error(`prismalens@${version} pins no archive for ${target}`);
	const url = `${base}/v${version}/${name}`;
	let bytes;
	// A network error or a 5xx is tried again; any other answer is the release's.
	for (let attempt = 1; !bytes; attempt++) {
		const res = await fetchImpl(url, {
			signal: AbortSignal.timeout(300_000),
		}).catch((e) => {
			if (attempt >= tries) throw e;
			return null;
		});
		if (res && !res.ok && (res.status < 500 || attempt >= tries))
			throw new Error(`${url} answered ${res.status}`);
		if (res?.ok) bytes = Buffer.from(await res.arrayBuffer());
	}
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (digest !== pinned)
		throw new Error(`${url} has sha256 ${digest}; the launcher pins ${pinned}`);
	const staged = join(mkdtempSync(join(root, "..", "published-")), name);
	writeFileSync(staged, bytes);
	publishToMirror(root, staged, version);
	rmSync(dirname(staged), { recursive: true, force: true });
}

/** The npm package at `version`, packed by the same script release.yml publishes with. */
export function packLauncherAt(version, outDir) {
	mkdirSync(outDir, { recursive: true });
	execFileSync(
		process.execPath,
		[
			join(ROOT, "scripts", "pack-launcher.mjs"),
			"--out",
			outDir,
			"--version",
			version,
		],
		{ cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
	);
	const tgz = join(outDir, `prismalens-${version}.tgz`);
	if (!existsSync(tgz))
		throw new Error(`pack-launcher.mjs --version ${version} left no ${tgz}`);
	return tgz;
}

/**
 * The mirror and launchers for `releases`, built from the app tarball `tgz`.
 * @param {{ tgz: string, work: string, releases: { version: string, launcher?: boolean, app?: string }[] }} options
 */
export function prepareLauncher({ tgz, work, releases }) {
	const root = join(work, "mirror");
	const launchers = {};
	const archives = {};
	mkdirSync(root, { recursive: true });
	const own = tarballVersion(tgz);
	for (const r of releases) {
		const archive = r.app
			? fakeArchive({
					version: r.version,
					app: r.app,
					outDir: work,
					schemaFrom: tgz,
				})
			: buildArchive(
					r.version === own ? tgz : retagTarball(tgz, r.version, work),
				);
		publishToMirror(root, archive, r.version);
		archives[r.version] = archive;
		if (r.launcher)
			launchers[r.version] = packLauncherAt(
				r.version,
				join(work, "launcher", r.version),
			);
	}
	return { root, baseUrl: pathToFileURL(root).href, launchers, archives };
}

/** The app folder of the runtime the launcher unpacked for `version` under `launcherDir`. */
export function runtimeAppDir(launcherDir, version) {
	const found = [];
	for (const entry of existsSync(launcherDir) ? readdirSync(launcherDir) : []) {
		const pkg = join(launcherDir, entry, "app", "package.json");
		if (!existsSync(pkg) || !statSync(join(launcherDir, entry)).isDirectory())
			continue;
		if (JSON.parse(readFileSync(pkg, "utf8")).version === version)
			found.push(join(launcherDir, entry, "app"));
	}
	if (found.length !== 1)
		throw new Error(
			`${found.length} runtimes of ${version} under ${launcherDir}: ${found.join(", ") || "none"}`,
		);
	return found[0];
}

/** A nightly version after `stable`, shaped as nightly.yml names them. */
export const nightlyAfter = (stable, date = "20261117") => {
	const [ma, mi, pa] = stable.split("-")[0].split(".").map(Number);
	return `${ma}.${mi}.${pa + 1}-nightly.${date}.1`;
};

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { values } = parseArgs({
		options: {
			tarball: { type: "string" },
			out: { type: "string" },
			release: { type: "string", multiple: true },
		},
	});
	if (!values.tarball || !values.out) {
		console.error(
			"usage: launcher-mirror.mjs --tarball <app.tgz> --out <dir> [--release <v>[:launcher]]...",
		);
		process.exit(2);
	}
	const tgz = resolve(values.tarball);
	const work = resolve(values.out);
	mkdirSync(work, { recursive: true });
	const releases = (values.release ?? [`${tarballVersion(tgz)}:launcher`]).map(
		(r) => {
			const [version, kind] = r.split(":");
			return { version, launcher: kind === "launcher" };
		},
	);
	const result = prepareLauncher({ tgz, work, releases });
	writeFileSync(join(work, "mirror.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
