#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The app as a user gets it from the official installer: install this build's zip with
 * scripts/install/install.{sh,ps1}, assert its launcher is in the OS's usual place, open the
 * app through that launcher until its window renders, then uninstall and assert both are gone.
 * A stand-in CLI archive rides along; the installers' own tests cover the CLI.
 *
 *   node scripts/smoke-installed.mjs <app.zip> <out.png>
 * Linux runs it under xvfb; the CI build job runs it after zipping the app.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [zipArg, outArg] = process.argv.slice(2);
if (!zipArg || !outArg)
	throw new Error("usage: smoke-installed.mjs <app.zip> <out.png>");
const zip = resolve(zipArg);
const out = resolve(outArg);
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../../..");
const version = JSON.parse(
	readFileSync(join(here, "../package.json"), "utf8"),
).version;
const win = process.platform === "win32";
const mac = process.platform === "darwin";
const target = win ? "win32-x64" : mac ? "darwin-arm64" : "linux-x64";
const asset = win
	? "PrismaLens-Windows-X64-unsigned.zip"
	: mac
		? "PrismaLens-macOS-ARM64-unsigned.zip"
		: "PrismaLens-Linux-X64-unsigned.zip";
const scratch = mkdtempSync(join(tmpdir(), "pl-installed-"));
const home = join(scratch, "home");
const workspace = join(scratch, "workspace");
mkdirSync(home, { recursive: true });

const check = (ok, what) => {
	if (!ok) {
		console.error(`FAIL ${what}`);
		process.exit(1);
	}
	console.log(`ok   ${what}`);
};
const sha256 = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

// A release-shaped base: v<version>/{CLI archive, app zip, SHA256SUMS}.
const release = join(scratch, "release", `v${version}`);
const cliTop = `prismalens-${version}-${target}`;
mkdirSync(join(scratch, "cli", cliTop, "bin"), { recursive: true });
let cliArchive;
if (win) {
	for (const name of ["pl", "prismalens"])
		writeFileSync(
			join(scratch, "cli", cliTop, "bin", `${name}.cmd`),
			`@echo ${version}\r\n`,
		);
	cliArchive = `${cliTop}.zip`;
	mkdirSync(release, { recursive: true });
	execFileSync(
		join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
		[
			"-a",
			"-cf",
			join(release, cliArchive),
			"-C",
			join(scratch, "cli"),
			cliTop,
		],
	);
} else {
	for (const name of ["pl", "prismalens"])
		writeFileSync(
			join(scratch, "cli", cliTop, "bin", name),
			`#!/bin/sh\necho ${version}\n`,
			{ mode: 0o755 },
		);
	cliArchive = `${cliTop}.tar.gz`;
	mkdirSync(release, { recursive: true });
	execFileSync("tar", [
		"-czf",
		join(release, cliArchive),
		"-C",
		join(scratch, "cli"),
		cliTop,
	]);
}
copyFileSync(zip, join(release, asset));
writeFileSync(
	join(release, "SHA256SUMS"),
	[cliArchive, asset]
		.map((f) => `${sha256(join(release, f))}  ${f}`)
		.join("\n") + "\n",
);

const env = {
	...process.env,
	HOME: home,
	PRISMALENS_RELEASE_BASE_URL: pathToFileURL(join(scratch, "release")).href,
	PRISMALENS_VERSION: version,
	PRISMALENS_DESKTOP: "1",
	PRISMALENS_NO_MODIFY_PATH: "1",
	NO_COLOR: "1",
	...(win
		? {
				PRISMALENS_HOME: join(scratch, "data"),
				PRISMALENS_INSTALL_BIN_DIR: join(scratch, "bin"),
			}
		: { XDG_DATA_HOME: join(home, ".local", "share") }),
};
// The installers print to stderr; capture it with the exit status.
const runInstaller = (args) => {
	const child = spawn(
		win ? "powershell" : "sh",
		win
			? [
					"-NoProfile",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					join(repo, "scripts/install/install.ps1"),
					...args,
				]
			: [join(repo, "scripts/install/install.sh"), ...args],
		{ env, stdio: ["ignore", "pipe", "pipe"] },
	);
	let text = "";
	child.stdout.on("data", (d) => (text += d));
	child.stderr.on("data", (d) => (text += d));
	return new Promise((r) => child.on("exit", (code) => r({ code, text })));
};
const shortcutDir = win
	? execFileSync(
			"powershell",
			["-NoProfile", "-Command", "[Environment]::GetFolderPath('Programs')"],
			{
				encoding: "utf8",
			},
		).trim()
	: "";
const launcher = win
	? join(shortcutDir, "PrismaLens.lnk")
	: mac
		? join(home, "Applications", "PrismaLens.app")
		: join(home, ".local", "share", "applications", "prismalens.desktop");

const installed = await runInstaller([]);
console.log(installed.text);
check(installed.code === 0, `the installer exited 0 (${installed.code})`);
check(existsSync(launcher), `the launcher is at ${launcher}`);
check(installed.text.includes(launcher), "the final message names it");

let open;
if (win) {
	const lnkTarget = execFileSync(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			`(New-Object -ComObject WScript.Shell).CreateShortcut('${launcher}').TargetPath`,
		],
		{ encoding: "utf8" },
	).trim();
	check(
		lnkTarget === join(scratch, "data", "desktop", version, "PrismaLens.exe"),
		`the shortcut opens ${lnkTarget}`,
	);
	// `start` opens the .lnk as Explorer would, and the app inherits this environment.
	open = () =>
		spawn("cmd", ["/c", "start", '""', `"${launcher}"`], {
			env: smokeEnv(),
			windowsVerbatimArguments: true,
		});
} else if (mac) {
	check(
		(() => {
			try {
				execFileSync("xattr", ["-p", "com.apple.quarantine", launcher], {
					stdio: "ignore",
				});
				return false;
			} catch {
				return true;
			}
		})(),
		"curl left no quarantine flag on the app, so its first open has no Gatekeeper prompt",
	);
	open = () =>
		spawn("open", [
			"-n",
			"--env",
			`PRISMALENS_DESKTOP_SMOKE=${out}`,
			"--env",
			`PRISMALENS_WORKSPACE_DIR=${workspace}`,
			"--env",
			"PRISMALENS_TELEMETRY=off",
			launcher,
		]);
} else {
	const entry = readFileSync(launcher, "utf8");
	const exec = /^Exec="([^"]+)"$/m.exec(entry)?.[1];
	const icon = /^Icon=(.+)$/m.exec(entry)?.[1];
	check(
		exec ===
			join(
				home,
				".local",
				"share",
				"prismalens",
				"desktop",
				"app",
				"prismalens",
			),
		`the entry runs ${exec}`,
	);
	check(
		!!icon && existsSync(icon) && statSync(icon).size > 1000,
		`the entry's icon is on disk: ${icon}`,
	);
	// A CI runner's Chromium sandbox helper is not setuid; the smoke runs unsandboxed there.
	open = () =>
		spawn(exec, ["--no-sandbox"], { env: smokeEnv(), stdio: "ignore" });
}

function smokeEnv() {
	return {
		...process.env,
		PRISMALENS_DESKTOP_SMOKE: out,
		PRISMALENS_WORKSPACE_DIR: workspace,
		PRISMALENS_TELEMETRY: "off",
	};
}

open();
const deadline = Date.now() + 180_000;
while (
	!(existsSync(out) && statSync(out).size > 10_000) &&
	Date.now() < deadline
)
	await new Promise((r) => setTimeout(r, 1000));
check(
	existsSync(out) && statSync(out).size > 10_000,
	`the app opened from its launcher and rendered ${basename(out)}`,
);
// The smoke capture quits the app; uninstall waits for its backend to let go.
const lock = join(workspace, "prismalens.lock");
for (let i = 0; i < 30 && existsSync(lock); i++)
	await new Promise((r) => setTimeout(r, 1000));
check(!existsSync(lock), "the app quit and released its workspace");
await new Promise((r) => setTimeout(r, 3000));

const removed = await runInstaller([win ? "-Uninstall" : "--uninstall"]);
console.log(removed.text);
check(removed.code === 0, `the uninstaller exited 0 (${removed.code})`);
check(!existsSync(launcher), "uninstall removed the launcher");
check(
	!existsSync(
		win
			? join(scratch, "data", "desktop")
			: mac
				? launcher
				: join(home, ".local", "share", "prismalens"),
	),
	"uninstall removed the app",
);
