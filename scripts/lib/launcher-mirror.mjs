// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What the release proofs install (#717): the packed launcher, plus this runner's standalone
// archive of each version in a release-shaped mirror (<root>/v<version>/{archive,SHA256SUMS})
// that the launcher reads through PRISMALENS_RELEASE_BASE_URL.
//   node scripts/lib/launcher-mirror.mjs --tarball <app.tgz> | --archive <release archive> --out <dir> --release <v>[:launcher]...
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
	renameSync,
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

/** The standalone archive a release attaches, as opposed to the app tarball it is built from. */
export const isArchive = (file) => /\.(tar\.gz|zip)$/.test(file);

const ARCHIVE_NAME =
	/^prismalens-(.+)-((?:darwin|linux|win32)-(?:x64|arm64))\.(?:tar\.gz|zip)$/;

function parseArchive(archive) {
	const m = ARCHIVE_NAME.exec(basename(archive));
	if (!m) throw new Error(`${archive} is not a prismalens standalone archive`);
	return { version: m[1], target: m[2] };
}

export const archiveVersion = (archive) => parseArchive(archive).version;

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

/** The tar that reads and writes a .zip: Windows ships it, and Git Bash's own cannot. */
const bsdtar = () =>
	WIN
		? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
		: "tar";

/** Extracts a release archive (tar.gz or zip) into `cwd`, or only its `members`. */
function extractArchive(archive, cwd, members = []) {
	const copy = join(cwd, basename(archive));
	copyFileSync(archive, copy);
	try {
		execFileSync(bsdtar(), ["-xf", basename(archive), ...members], { cwd });
	} finally {
		rmSync(copy, { force: true });
	}
}

/** Writes `archive` from the folder `top` under `stage`: a zip for a .zip name, else a tar.gz. */
function packArchive(stage, top, archive) {
	const flag = archive.endsWith(".zip") ? "-a" : "-z";
	execFileSync(bsdtar(), [flag, "-cf", archive, top], { cwd: stage });
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

/**
 * A copy of a release's own archive under another version: the same node and app bytes, with the
 * folder and `app/package.json` renamed, as retagTarball does for the app tarball.
 */
export function retagArchive(archive, version, dir) {
	const { version: from, target } = parseArchive(archive);
	const stage = mkdtempSync(join(dir, "retag-archive-"));
	extractArchive(archive, stage);
	const top = `prismalens-${version}-${target}`;
	renameSync(join(stage, `prismalens-${from}-${target}`), join(stage, top));
	const manifest = join(stage, top, "app", "package.json");
	const pkg = JSON.parse(readFileSync(manifest, "utf8"));
	pkg.version = version;
	writeFileSync(manifest, JSON.stringify(pkg, null, 2));
	const out = join(dir, archiveFile(version, target));
	rmSync(out, { force: true });
	packArchive(stage, top, out);
	rmSync(stage, { recursive: true, force: true });
	return out;
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
		// An app tarball holds the migrations under package/, a release archive under its app/.
		let root = "package";
		if (isArchive(schemaFrom)) {
			const own = parseArchive(schemaFrom);
			root = `prismalens-${own.version}-${own.target}/app`;
			extractArchive(schemaFrom, unpack, [`${root}/${SCHEMA}`]);
		} else extractCopy(schemaFrom, unpack, [`${root}/${SCHEMA}`]);
		cpSync(join(unpack, root, SCHEMA), join(stage, top, "app", SCHEMA), {
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
	packArchive(stage, top, archive);
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

/** Throws unless `archive` is the release's archive for `target` and has the digest its launcher pins. */
export function assertPinnedArchive(
	{ version, sha256: pins },
	archive,
	target = ownTarget(),
) {
	const pinned = pins[target];
	if (!pinned)
		throw new Error(`prismalens@${version} pins no archive for ${target}`);
	if (basename(archive) !== archiveFile(version, target))
		throw new Error(
			`${archive} is not ${archiveFile(version, target)}, the archive of ${version} for ${target}`,
		);
	const digest = sha256(archive);
	if (digest !== pinned)
		throw new Error(
			`${archive} has sha256 ${digest}; the launcher pins ${pinned}`,
		);
}

/** The release a packed launcher is pinned to: its version and each target's archive digest. */
export function launcherPins(launcher) {
	const manifest = JSON.parse(
		tarIn(launcher, ["-xzOf", "package/package.json"]),
	);
	return {
		version: manifest.version,
		sha256: manifest.prismalens?.release?.sha256 ?? {},
	};
}

/**
 * The mirror for a release before it is public: the draft's own archive for this runner, served as
 * it is, and the launcher npm will carry, packed once and pinned to the draft's digests.
 * @param {{ archive: string, launcher: string, work: string, releases?: { version: string }[] }} options
 */
export function prepareDraftRelease({
	archive,
	launcher,
	work,
	releases = [],
}) {
	const pins = launcherPins(launcher);
	const version = archiveVersion(archive);
	if (pins.version !== version)
		throw new Error(
			`the launcher is ${pins.version} and the archive ${version}; they are not one release`,
		);
	assertPinnedArchive(pins, archive);
	return prepareLauncher({
		archive,
		work,
		releases: [{ version, launcher }, ...releases],
	});
}

/** The npm package at `version`, packed by the same script release.yml publishes with. */
export function packLauncherAt(version, outDir, extra = []) {
	mkdirSync(outDir, { recursive: true });
	execFileSync(
		process.execPath,
		[
			join(ROOT, "scripts", "pack-launcher.mjs"),
			"--out",
			outDir,
			"--version",
			version,
			...extra,
		],
		{ cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
	);
	const tgz = join(outDir, `prismalens-${version}.tgz`);
	if (!existsSync(tgz))
		throw new Error(`pack-launcher.mjs --version ${version} left no ${tgz}`);
	return tgz;
}

/**
 * The mirror and launchers for `releases`, built from the app tarball `tgz`, or from a release's
 * own archive `archive` (its version and this runner's target), whose bytes are served as they are.
 * A release's `launcher` is packed here, or is the path of a launcher packed already.
 * @param {{ tgz?: string, archive?: string, work: string, releases: { version: string, launcher?: boolean | string, app?: string }[] }} options
 */
export function prepareLauncher({ tgz, archive: source, work, releases }) {
	if (!tgz === !source)
		throw new Error(
			"prepareLauncher takes an app tarball or a release archive",
		);
	const root = join(work, "mirror");
	const launchers = {};
	const archives = {};
	mkdirSync(root, { recursive: true });
	const own = tgz ? tarballVersion(tgz) : archiveVersion(source);
	for (const r of releases) {
		let archive;
		if (r.app)
			archive = fakeArchive({
				version: r.version,
				app: r.app,
				outDir: work,
				schemaFrom: tgz ?? source,
			});
		else if (source)
			archive =
				r.version === own ? source : retagArchive(source, r.version, work);
		else
			archive = buildArchive(
				r.version === own ? tgz : retagTarball(tgz, r.version, work),
			);
		publishToMirror(root, archive, r.version);
		archives[r.version] = archive;
		if (typeof r.launcher === "string") launchers[r.version] = r.launcher;
		else if (r.launcher)
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
			archive: { type: "string" },
			launcher: { type: "string" },
			out: { type: "string" },
			release: { type: "string", multiple: true },
		},
	});
	if (!values.out || !values.tarball === !values.archive) {
		console.error(
			"usage: launcher-mirror.mjs (--tarball <app.tgz> | --archive <release archive> [--launcher <pinned launcher.tgz>]) --out <dir> [--release <v>[:launcher]]...",
		);
		process.exit(2);
	}
	const work = resolve(values.out);
	mkdirSync(work, { recursive: true });
	let result;
	if (values.archive && values.launcher) {
		result = prepareDraftRelease({
			archive: resolve(values.archive),
			launcher: resolve(values.launcher),
			work,
			releases: (values.release ?? []).map((version) => ({ version })),
		});
	} else {
		const tgz = values.tarball && resolve(values.tarball);
		const archive = values.archive && resolve(values.archive);
		const own = tgz ? tarballVersion(tgz) : archiveVersion(archive);
		const releases = (values.release ?? [`${own}:launcher`]).map((r) => {
			const [version, kind] = r.split(":");
			return { version, launcher: kind === "launcher" };
		});
		result = prepareLauncher({ tgz, archive, work, releases });
	}
	writeFileSync(join(work, "mirror.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
