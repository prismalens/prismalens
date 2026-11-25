#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Packs, checks and publishes the `prismalens` npm package: the launcher alone, stable only (#717).
//   node scripts/pack-launcher.mjs [--out <dir>] [--version <v>] [--tag <dist-tag>]
//     [--release-base <url>] [--pin] [--assets <dir>] [--publish | --publish-dry-run] [--tarball <launcher.tgz>]
//   --pin: pin digests read from the public release. --assets: pin them from a folder of the
//   release's archives and SHA256SUMS (a draft, downloaded) instead. --publish --tarball: publish
//   the launcher packed earlier, once the public release has the digests it pins.
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBuildSha, resolvePublishTag } from "./pack-cli.mjs";
import { readPublic, TARGETS } from "./release-complete.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_DIR = join(ROOT, "packages", "cli");
const STAGING = join(CLI_DIR, ".launcher-staging");

/** Old service units and npm's bin links point at this path; it never moves. */
export const BIN = "dist/bin/prismalens.js";
const SOURCES = {
	[BIN]: "prismalens.mjs",
	"dist/bin/launcher.mjs": "launcher.mjs",
	"dist/bin/ini.cjs": "ini.cjs",
};
const DOCS = ["README.md", "LICENSE", "NOTICE"];
export const ENTRIES = ["package.json", ...Object.keys(SOURCES), ...DOCS]
	.map((e) => `package/${e}`)
	.sort();
const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"bundleDependencies",
	"bundledDependencies",
	"overrides",
];

export function launcherManifest(cli, options = {}) {
	const version = options.version ?? cli.version;
	const manifest = {
		name: cli.name,
		version,
		description: cli.description,
		license: cli.license,
		type: "module",
		bin: { prismalens: BIN, pl: BIN },
		files: ["dist", "NOTICE"],
		repository: cli.repository,
		homepage: cli.homepage,
		bugs: cli.bugs,
		keywords: cli.keywords,
		// http.setGlobalProxyFromEnv, which a download through a proxy needs, is in 24.14.
		engines: { node: ">=24.14.0" },
		publishConfig: { access: "public" },
		prismalens: {
			release: {
				channel: version.includes("-") ? "nightly" : "stable",
				tag: `v${version}`,
				version,
			},
		},
	};
	if (options.build) manifest.build = options.build;
	return manifest;
}

/** The structural guard: what npm serves can never send a proxy after a first-party package. */
export function assertLauncherManifest(manifest) {
	const problems = [];
	for (const field of DEPENDENCY_FIELDS) {
		if (manifest[field] !== undefined)
			problems.push(`declares ${field} (${JSON.stringify(manifest[field])})`);
	}
	const text = JSON.stringify(manifest);
	if (/"@prismalens\//.test(text))
		problems.push("names an @prismalens/* package");
	if (manifest.scripts !== undefined) problems.push("declares scripts");
	for (const name of ["prismalens", "pl"])
		if (manifest.bin?.[name] !== BIN)
			problems.push(`bin ${name} is not ${BIN}`);
	const r = manifest.prismalens?.release;
	if (!r?.tag || !r?.version || !["stable", "nightly"].includes(r?.channel))
		problems.push("has no prismalens.release {channel, tag, version}");
	if (problems.length)
		throw new Error(`the launcher manifest ${problems.join("; ")}`);
}

export function assertLauncherEntries(entries) {
	const got = [...entries].sort();
	if (JSON.stringify(got) !== JSON.stringify(ENTRIES))
		throw new Error(
			`the launcher tarball holds ${got.join(", ")}; it must hold exactly ${ENTRIES.join(", ")}`,
		);
}

/**
 * npm carries stable launchers only, once their release is public and complete. Returns the
 * archives' digests, which the published manifest pins, so a release or mirror that later
 * swaps an archive together with its SHA256SUMS line is refused (#717).
 */
export async function assertPublishable(manifest, base) {
	const { channel, tag, version } = manifest.prismalens.release;
	if (channel !== "stable" || version.includes("-"))
		throw new Error(
			`npm carries stable launchers only; ${version} is a ${channel} version`,
		);
	const { problems, digests } = await readPublic({ base, tag, version });
	if (problems.length)
		throw new Error(
			`release ${tag} is not public and complete, so its launcher is not published: ${problems.join("; ")}`,
		);
	return digests;
}

/**
 * The digests a launcher pins, read from a folder holding the release's archives and SHA256SUMS
 * (a draft release downloaded), refused unless every archive is there and matches its line.
 */
export async function assertAssets(manifest, dir) {
	const { channel, version } = manifest.prismalens.release;
	if (channel !== "stable" || version.includes("-"))
		throw new Error(
			`npm carries stable launchers only; ${version} is a ${channel} version`,
		);
	const folder = resolve(dir);
	const { problems, digests } = await readPublic({
		base: pathToFileURL(dirname(folder)).href,
		tag: basename(folder),
		version,
	});
	if (problems.length)
		throw new Error(
			`${folder} is not the complete release ${version}, so its launcher is not pinned: ${problems.join("; ")}`,
		);
	return digests;
}

/** A published launcher pins every target's archive digest. */
export function assertPinned(manifest) {
	const pins = manifest.prismalens.release.sha256 ?? {};
	const unpinned = TARGETS.filter((t) => !/^[0-9a-f]{64}$/.test(pins[t] ?? ""));
	if (unpinned.length)
		throw new Error(
			`the launcher manifest pins no archive digest for ${unpinned.join(", ")}`,
		);
}

function npm(args, cwd) {
	const win = process.platform === "win32";
	return execFileSync(
		win ? "cmd.exe" : "npm",
		win ? ["/d", "/c", "npm", ...args] : args,
		{ cwd, stdio: ["ignore", "inherit", "inherit"] },
	);
}

const tar = (tarball, args) =>
	execFileSync("tar", [...args, basename(tarball)], {
		cwd: dirname(tarball),
		encoding: "utf8",
	});

function npmPublish(tarball, { tag, version, dryRun }) {
	const dist = resolvePublishTag({ tag, version });
	const args = ["publish", tarball, "--access", "public", "--tag", dist];
	if (dryRun) args.push("--dry-run");
	console.log(`==> npm ${args.join(" ")}`);
	npm(args, ROOT);
}

/**
 * Publishes a launcher packed earlier, never a new pack of it: its entries and manifest are
 * checked again, and the public release must hold exactly the archives it pins.
 */
export async function publishPacked(tarball, { tag, dryRun = false, base }) {
	assertLauncherEntries(tar(tarball, ["-tzf"]).split("\n").filter(Boolean));
	const manifest = JSON.parse(readPacked(tarball));
	assertLauncherManifest(manifest);
	assertPinned(manifest);
	const digests = await assertPublishable(manifest, base);
	const pins = manifest.prismalens.release.sha256;
	const changed = TARGETS.filter((t) => digests[t] !== pins[t]);
	if (changed.length)
		throw new Error(
			`the public release no longer holds the archives the launcher pins: ${changed.join(", ")}`,
		);
	npmPublish(tarball, { tag, version: manifest.version, dryRun });
}

export async function packLauncher(argv = []) {
	const opt = (name) => {
		const i = argv.indexOf(name);
		return i === -1 ? undefined : argv[i + 1];
	};
	if (opt("--tarball")) {
		if (!argv.includes("--publish") && !argv.includes("--publish-dry-run"))
			throw new Error("--tarball is the launcher --publish sends to npm");
		return publishPacked(resolve(opt("--tarball")), {
			tag: opt("--tag"),
			dryRun: argv.includes("--publish-dry-run"),
			base: opt("--release-base"),
		});
	}
	const out = resolve(opt("--out") ?? join(CLI_DIR, "dist-launcher"));
	const cli = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
	const manifest = launcherManifest(cli, {
		version: opt("--version"),
		build: resolveBuildSha(),
	});
	assertLauncherManifest(manifest);
	const publish =
		argv.includes("--publish") || argv.includes("--publish-dry-run");
	if (publish && opt("--assets"))
		throw new Error(
			"--assets pins from a local folder; --publish reads the public release",
		);
	if (opt("--assets")) {
		manifest.prismalens.release.sha256 = await assertAssets(
			manifest,
			opt("--assets"),
		);
		assertPinned(manifest);
	} else if (publish || argv.includes("--pin")) {
		manifest.prismalens.release.sha256 = await assertPublishable(
			manifest,
			opt("--release-base"),
		);
		assertPinned(manifest);
	}

	const staging = `${STAGING}-${process.pid}`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(join(staging, "dist", "bin"), { recursive: true });
	for (const [to, from] of Object.entries(SOURCES))
		copyFileSync(join(ROOT, "scripts", "launcher", from), join(staging, to));
	for (const doc of DOCS) copyFileSync(join(CLI_DIR, doc), join(staging, doc));
	writeFileSync(
		join(staging, "package.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);

	mkdirSync(out, { recursive: true });
	const name = `prismalens-${manifest.version}.tgz`;
	rmSync(join(out, name), { force: true });
	try {
		npm(["pack", "--pack-destination", out, "--loglevel", "warn"], staging);
	} finally {
		// Kept at one path for publint:packed; built per process so parallel packs never mix.
		rmSync(STAGING, { recursive: true, force: true });
		renameSync(staging, STAGING);
	}
	if (!readdirSync(out).includes(name))
		throw new Error(`npm pack produced no ${name} in ${out}`);
	const tarball = join(out, name);
	assertLauncherEntries(tar(tarball, ["-tzf"]).split("\n").filter(Boolean));
	assertLauncherManifest(JSON.parse(readPacked(tarball)));
	console.log(`==> ${tarball} (${manifest.prismalens.release.tag})`);

	if (publish)
		npmPublish(tarball, {
			tag: opt("--tag"),
			version: manifest.version,
			dryRun: argv.includes("--publish-dry-run"),
		});
	return tarball;
}

function readPacked(tarball) {
	return execFileSync(
		"tar",
		["-xzOf", basename(tarball), "package/package.json"],
		{ cwd: dirname(tarball), encoding: "utf8" },
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		await packLauncher(process.argv.slice(2));
	} catch (e) {
		console.error(`\nPACK FAIL: ${e.message}\n`);
		process.exit(1);
	}
}
