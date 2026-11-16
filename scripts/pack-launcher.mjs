#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Packs, checks and publishes the `prismalens` npm package: the launcher alone (#717).
//   node scripts/pack-launcher.mjs [--out <dir>] [--channel stable|nightly] [--release-tag <tag>]
//     [--release-version <v>] [--tag <dist-tag>] [--publish | --publish-dry-run]
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildSha, resolvePublishTag } from "./pack-cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_DIR = join(ROOT, "packages", "cli");
const STAGING = join(CLI_DIR, ".launcher-staging");

/** Old service units and npm's bin links point at this path; it never moves. */
export const BIN = "dist/bin/prismalens.js";
const DOCS = ["README.md", "LICENSE", "NOTICE"];
export const ENTRIES = ["package.json", BIN, ...DOCS]
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
	const version = cli.version;
	const channel =
		options.channel ?? (version.includes("-nightly.") ? "nightly" : "stable");
	if (channel !== "stable" && channel !== "nightly")
		throw new Error(`--channel takes stable or nightly, not "${channel}"`);
	const releaseVersion = options.releaseVersion ?? version;
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
		engines: { node: ">=24" },
		publishConfig: { access: "public" },
		prismalens: {
			release: {
				channel,
				tag: options.releaseTag ?? `v${releaseVersion}`,
				version: releaseVersion,
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

export function packLauncher(argv = []) {
	const opt = (name) => {
		const i = argv.indexOf(name);
		return i === -1 ? undefined : argv[i + 1];
	};
	const out = resolve(opt("--out") ?? join(CLI_DIR, "dist-launcher"));
	const cli = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
	const manifest = launcherManifest(cli, {
		channel: opt("--channel"),
		releaseTag: opt("--release-tag"),
		releaseVersion: opt("--release-version"),
		build: resolveBuildSha(),
	});
	assertLauncherManifest(manifest);

	rmSync(STAGING, { recursive: true, force: true });
	mkdirSync(join(STAGING, "dist", "bin"), { recursive: true });
	copyFileSync(
		join(ROOT, "scripts", "launcher", "prismalens.mjs"),
		join(STAGING, BIN),
	);
	for (const doc of DOCS) copyFileSync(join(CLI_DIR, doc), join(STAGING, doc));
	writeFileSync(
		join(STAGING, "package.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);

	mkdirSync(out, { recursive: true });
	for (const f of readdirSync(out))
		if (f.endsWith(".tgz")) rmSync(join(out, f));
	npm(["pack", "--pack-destination", out, "--loglevel", "warn"], STAGING);
	const packed = readdirSync(out).find((f) => f.endsWith(".tgz"));
	if (!packed) throw new Error(`npm pack produced no tarball in ${out}`);
	const tarball = join(out, packed);
	assertLauncherEntries(tar(tarball, ["-tzf"]).split("\n").filter(Boolean));
	assertLauncherManifest(JSON.parse(readPacked(tarball)));
	console.log(`==> ${tarball} (${manifest.prismalens.release.tag})`);

	if (argv.includes("--publish") || argv.includes("--publish-dry-run")) {
		const tag = resolvePublishTag({ tag: opt("--tag"), version: cli.version });
		const args = ["publish", tarball, "--access", "public", "--tag", tag];
		if (argv.includes("--publish-dry-run")) args.push("--dry-run");
		console.log(`==> npm ${args.join(" ")}`);
		npm(args, ROOT);
	}
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
		packLauncher(process.argv.slice(2));
	} catch (e) {
		console.error(`\nPACK FAIL: ${e.message}\n`);
		process.exit(1);
	}
}
