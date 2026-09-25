#!/usr/bin/env node
// Build standalone CLI archive with bundled Node runtime (#717).
// Native addons require building on the target platform; no new dependencies.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import {
	chmodSync,
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
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

function getArg(flag) {
	const idx = process.argv.indexOf(flag);
	if (idx !== -1 && idx + 1 < process.argv.length) {
		return process.argv[idx + 1];
	}
	return null;
}

function getTarget() {
	const platform = process.platform;
	const arch = process.arch;
	const target = `${platform}-${arch}`;
	const valid = [
		"darwin-arm64",
		"darwin-x64",
		"linux-x64",
		"linux-arm64",
		"win32-x64",
	];
	if (!valid.includes(target)) {
		throw new Error(
			`Unsupported platform/arch: ${target}. Supported: ${valid.join(", ")}`,
		);
	}
	return target;
}

function resolveTarball(argTarball) {
	if (argTarball) {
		const abs = resolve(process.cwd(), argTarball);
		if (!existsSync(abs)) {
			throw new Error(`Tarball not found at ${abs}`);
		}
		return abs;
	}
	const tarballTxt = join(REPO_ROOT, "packages/cli/dist-pack/tarball.txt");
	if (existsSync(tarballTxt)) {
		const p = readFileSync(tarballTxt, "utf8").trim();
		if (existsSync(p)) return p;
	}
	const distPack = join(REPO_ROOT, "packages/cli/dist-pack");
	if (existsSync(distPack)) {
		const f = readdirSync(distPack).find((e) => e.endsWith(".tgz"));
		if (f) return join(distPack, f);
	}
	throw new Error("No tarball provided. Specify --tarball <path>");
}

function extractTarballVersion(tarballPath) {
	try {
		// Relative name from the tarball's dir: Git-Bash's GNU tar reads `D:\...` as a remote host.
		const out = execFileSync(
			"tar",
			["-xzOf", basename(tarballPath), "package/package.json"],
			{
				cwd: dirname(tarballPath),
				encoding: "utf8",
			},
		);
		const pkg = JSON.parse(out);
		if (pkg.version) return pkg.version;
	} catch (e) {
		throw new Error(
			`Failed to read package.json from tarball ${tarballPath}: ${e.message}`,
		);
	}
	throw new Error(`Could not determine version from tarball ${tarballPath}`);
}

function getNodeArchiveName(target, nodeVersion) {
	switch (target) {
		case "darwin-arm64":
			return `node-${nodeVersion}-darwin-arm64.tar.gz`;
		case "darwin-x64":
			return `node-${nodeVersion}-darwin-x64.tar.gz`;
		case "linux-x64":
			return `node-${nodeVersion}-linux-x64.tar.gz`;
		case "linux-arm64":
			return `node-${nodeVersion}-linux-arm64.tar.gz`;
		case "win32-x64":
			return `node-${nodeVersion}-win-x64.zip`;
		default:
			throw new Error(`Unhandled target ${target}`);
	}
}

async function resolveNodeRelease(major) {
	const res = await fetch("https://nodejs.org/dist/index.json");
	if (!res.ok) {
		throw new Error(
			`Failed to fetch nodejs dist index: HTTP ${res.status} ${res.statusText}`,
		);
	}
	const releases = await res.json();
	const prefix = `v${major}.`;
	const matching = releases.filter((r) => r.version.startsWith(prefix));
	if (matching.length === 0) {
		throw new Error(`No Node releases found for major version ${major}`);
	}
	// Sort by semver descending
	matching.sort((a, b) => {
		const pa = a.version.replace(/^v/, "").split(".").map(Number);
		const pb = b.version.replace(/^v/, "").split(".").map(Number);
		for (let i = 0; i < 3; i++) {
			if (pa[i] !== pb[i]) return pb[i] - pa[i];
		}
		return 0;
	});
	return matching[0].version;
}

async function downloadAndVerifyNode(nodeVersion, archiveName) {
	const shasumsUrl = `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`;
	const shasumsRes = await fetch(shasumsUrl);
	if (!shasumsRes.ok) {
		throw new Error(`Failed to fetch ${shasumsUrl}: HTTP ${shasumsRes.status}`);
	}
	const shasumsText = await shasumsRes.text();
	const lines = shasumsText.split("\n");
	let expectedHash = null;
	for (const line of lines) {
		const parts = line.trim().split(/\s+/);
		if (parts.length >= 2 && parts[1] === archiveName) {
			expectedHash = parts[0].toLowerCase();
			break;
		}
	}
	if (!expectedHash) {
		throw new Error(
			`Could not find checksum for ${archiveName} in SHASUMS256.txt`,
		);
	}

	const cacheDir = join(tmpdir(), "pl-node-cache");
	mkdirSync(cacheDir, { recursive: true });
	const cacheFile = join(cacheDir, archiveName);

	if (existsSync(cacheFile)) {
		const buf = readFileSync(cacheFile);
		const existingHash = crypto
			.createHash("sha256")
			.update(buf)
			.digest("hex")
			.toLowerCase();
		if (existingHash === expectedHash) {
			console.log(`Using cached ${archiveName}`);
			return cacheFile;
		}
		rmSync(cacheFile, { force: true });
	}

	const archiveUrl = `https://nodejs.org/dist/${nodeVersion}/${archiveName}`;
	console.log(`Downloading ${archiveUrl}...`);
	const res = await fetch(archiveUrl);
	if (!res.ok) {
		throw new Error(`Failed to download ${archiveUrl}: HTTP ${res.status}`);
	}
	const arrayBuffer = await res.arrayBuffer();
	const buf = Buffer.from(arrayBuffer);
	const actualHash = crypto
		.createHash("sha256")
		.update(buf)
		.digest("hex")
		.toLowerCase();

	if (actualHash !== expectedHash) {
		throw new Error(
			`Checksum mismatch for ${archiveName}!\nExpected: ${expectedHash}\nActual:   ${actualHash}`,
		);
	}

	writeFileSync(cacheFile, buf);
	return cacheFile;
}

function extractNodeArchive(archivePath, destDir) {
	mkdirSync(destDir, { recursive: true });
	if (archivePath.endsWith(".tar.gz")) {
		execFileSync(
			"tar",
			["-xzf", archivePath, "-C", destDir, "--strip-components=1"],
			{
				stdio: "inherit",
			},
		);
	} else if (archivePath.endsWith(".zip")) {
		const tempExtract = mkdtempSync(join(tmpdir(), "node-zip-"));
		try {
			let extracted = false;
			try {
				execFileSync("tar", ["-xf", archivePath, "-C", tempExtract], {
					stdio: "pipe",
				});
				extracted = true;
			} catch {
				extracted = false;
			}
			if (!extracted) {
				try {
					execFileSync("7z", ["x", archivePath, `-o${tempExtract}`, "-y"], {
						stdio: "pipe",
					});
					extracted = true;
				} catch {
					extracted = false;
				}
			}
			if (!extracted) {
				execFileSync(
					"powershell",
					[
						"-NoProfile",
						"-Command",
						`Expand-Archive -Path '${archivePath}' -DestinationPath '${tempExtract}' -Force`,
					],
					{ stdio: "inherit" },
				);
			}

			const topDirs = readdirSync(tempExtract).filter(
				(e) =>
					existsSync(join(tempExtract, e)) &&
					statSync(join(tempExtract, e)).isDirectory(),
			);
			const innerDir =
				topDirs.length === 1 ? join(tempExtract, topDirs[0]) : tempExtract;
			cpSync(innerDir, destDir, { recursive: true });
		} finally {
			rmSync(tempExtract, { recursive: true, force: true });
		}
	} else {
		throw new Error(`Unknown archive format: ${archivePath}`);
	}
}

function writeLaunchers(binDir, isWindows) {
	mkdirSync(binDir, { recursive: true });

	const unixScript = `#!/bin/sh
set -e
TARGET="$0"
while [ -h "$TARGET" ]; do
  DIR="$(cd -P "$(dirname "$TARGET")" >/dev/null 2>&1 && pwd)"
  TARGET="$(readlink "$TARGET")"
  case "$TARGET" in
    /*) ;;
    *) TARGET="$DIR/$TARGET" ;;
  esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$TARGET")" >/dev/null 2>&1 && pwd)"
export PRISMALENS_INSTALL=standalone
if [ -f "$SCRIPT_DIR/../node/bin/node" ]; then
  exec "$SCRIPT_DIR/../node/bin/node" "$SCRIPT_DIR/../lib/node_modules/prismalens/dist/bin/prismalens.js" "$@"
elif [ -f "$SCRIPT_DIR/../node/node.exe" ]; then
  exec "$SCRIPT_DIR/../node/node.exe" "$SCRIPT_DIR/../lib/node_modules/prismalens/dist/bin/prismalens.js" "$@"
else
  exec "$SCRIPT_DIR/../node/node" "$SCRIPT_DIR/../lib/node_modules/prismalens/dist/bin/prismalens.js" "$@"
fi
`;

	const winCmd = `@echo off
setlocal
set "PRISMALENS_INSTALL=standalone"
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%..\\node\\node.exe" (
  set "NODE_EXE=%SCRIPT_DIR%..\\node\\node.exe"
) else if exist "%SCRIPT_DIR%..\\node\\bin\\node.exe" (
  set "NODE_EXE=%SCRIPT_DIR%..\\node\\bin\\node.exe"
) else (
  set "NODE_EXE=%SCRIPT_DIR%..\\node\\bin\\node"
)
"%NODE_EXE%" "%SCRIPT_DIR%..\\lib\\node_modules\\prismalens\\dist\\bin\\prismalens.js" %*
`;

	if (isWindows) {
		writeFileSync(join(binDir, "pl.cmd"), winCmd);
		writeFileSync(join(binDir, "prismalens.cmd"), winCmd);
		writeFileSync(join(binDir, "pl"), unixScript);
		writeFileSync(join(binDir, "prismalens"), unixScript);
	} else {
		writeFileSync(join(binDir, "pl"), unixScript);
		writeFileSync(join(binDir, "prismalens"), unixScript);
		chmodSync(join(binDir, "pl"), 0o755);
		chmodSync(join(binDir, "prismalens"), 0o755);
	}
}

function packageArchive(stageDir, bundleName, outDir, isWindows) {
	mkdirSync(outDir, { recursive: true });
	const archiveName = isWindows ? `${bundleName}.zip` : `${bundleName}.tar.gz`;
	const archivePath = join(outDir, archiveName);

	if (existsSync(archivePath)) {
		rmSync(archivePath, { force: true });
	}

	if (isWindows) {
		let zipped = false;
		try {
			execFileSync("7z", ["a", "-tzip", archivePath, bundleName], {
				cwd: stageDir,
				stdio: "pipe",
			});
			zipped = true;
		} catch {
			zipped = false;
		}
		if (!zipped) {
			try {
				execFileSync("tar", ["-a", "-cf", archivePath, bundleName], {
					cwd: stageDir,
					stdio: "pipe",
				});
				zipped = true;
			} catch {
				zipped = false;
			}
		}
		if (!zipped) {
			execFileSync(
				"powershell",
				[
					"-NoProfile",
					"-Command",
					`Compress-Archive -Path '${join(stageDir, bundleName)}' -DestinationPath '${archivePath}' -Force`,
				],
				{ stdio: "inherit" },
			);
		}
	} else {
		execFileSync("tar", ["-czf", archivePath, "-C", stageDir, bundleName], {
			stdio: "inherit",
		});
	}

	const bytes = statSync(archivePath).size;
	console.log(
		`\n==> Created ${archivePath} (${(bytes / 1024 / 1024).toFixed(2)} MB)`,
	);
	return archivePath;
}

async function main() {
	const target = getTarget();
	const isWindows = process.platform === "win32";

	const argTarball = getArg("--tarball");
	const tarballPath = resolveTarball(argTarball);
	console.log(`==> Tarball: ${tarballPath}`);

	const argOut = getArg("--out");
	const outDir = argOut
		? resolve(process.cwd(), argOut)
		: join(REPO_ROOT, "dist/standalone");

	const version = extractTarballVersion(tarballPath);
	console.log(`==> Package version: ${version}`);
	console.log(`==> Target: ${target}`);

	const nvmrcPath = join(REPO_ROOT, ".nvmrc");
	const major = readFileSync(nvmrcPath, "utf8").trim();
	console.log(`==> Node major from .nvmrc: ${major}`);

	const nodeVersion = await resolveNodeRelease(major);
	console.log(`==> Resolved Node version: ${nodeVersion}`);

	const nodeArchiveName = getNodeArchiveName(target, nodeVersion);
	const downloadedNodePath = await downloadAndVerifyNode(
		nodeVersion,
		nodeArchiveName,
	);

	const stage = mkdtempSync(join(tmpdir(), "pl-standalone-stage-"));
	try {
		const bundleName = `prismalens-${version}-${target}`;
		const bundleDir = join(stage, bundleName);
		mkdirSync(bundleDir, { recursive: true });

		// 1. Extract Node into <stage>/node/
		const nodeDir = join(bundleDir, "node");
		console.log(`==> Extracting Node into ${nodeDir}`);
		extractNodeArchive(downloadedNodePath, nodeDir);

		// Locate bundled node and npm-cli
		let bundledNode = join(nodeDir, "bin", "node");
		if (isWindows) {
			bundledNode = existsSync(join(nodeDir, "node.exe"))
				? join(nodeDir, "node.exe")
				: join(nodeDir, "bin", "node.exe");
		}
		if (!existsSync(bundledNode)) {
			throw new Error(`Bundled node executable not found at ${bundledNode}`);
		}
		if (!isWindows) {
			chmodSync(bundledNode, 0o755);
		}

		let bundledNpmCli = join(
			nodeDir,
			"lib",
			"node_modules",
			"npm",
			"bin",
			"npm-cli.js",
		);
		if (!existsSync(bundledNpmCli)) {
			bundledNpmCli = join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
		}
		if (!existsSync(bundledNpmCli)) {
			throw new Error(`Bundled npm-cli.js not found in ${nodeDir}`);
		}

		// 2. Install tarball with the BUNDLED node's npm
		const libDir = join(bundleDir, "lib");
		mkdirSync(libDir, { recursive: true });
		console.log(`==> Installing ${tarballPath} with bundled node npm`);
		const nodeBinDir = dirname(bundledNode);
		const rawPath =
			process.env.PATH ||
			(process.platform === "win32"
				? Object.entries(process.env).find(
						([k]) => k.toLowerCase() === "path",
					)?.[1] || ""
				: "");
		const env = {
			...process.env,
			PATH: `${nodeBinDir}${delimiter}${rawPath}`,
		};
		if (process.platform === "win32") {
			env.Path = env.PATH;
		}

		execFileSync(
			bundledNode,
			[
				bundledNpmCli,
				"install",
				"--prefix",
				libDir,
				"--omit=dev",
				"--no-audit",
				"--no-fund",
				tarballPath,
			],
			{
				stdio: "inherit",
				env,
			},
		);

		// 3. Write launchers in <stage>/bin/
		const binDir = join(bundleDir, "bin");
		console.log(`==> Writing launchers in ${binDir}`);
		writeLaunchers(binDir, isWindows);

		// 4. Package as prismalens-<version>-<target>.tar.gz or .zip
		console.log(`==> Packaging standalone archive in ${outDir}`);
		packageArchive(stage, bundleName, outDir, isWindows);
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(`ERROR: ${err.message}`);
	process.exit(1);
});
