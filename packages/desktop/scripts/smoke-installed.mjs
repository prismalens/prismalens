#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The app as a user gets it from the official installer, over HTTP as curl downloads it: install
 * an older release, upgrade to this build's zip, assert the launcher is in the OS's usual place and
 * opens this version to its first screen, then uninstall and assert both are gone. Stand-in CLI
 * archives ride along; the installers' own tests cover the CLI.
 *
 *   node scripts/smoke-installed.mjs <app.zip> <out.png>
 * Linux runs it under xvfb; the CI build job runs it after zipping the app.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const older = "0.0.1";
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A release-shaped tree: v<version>/{CLI archive, app zip, SHA256SUMS}. The older release carries
// the same app bits under its own version, which is all an upgrade's file moves see.
function stage(v) {
	const dir = join(scratch, "release", `v${v}`);
	const top = `prismalens-${v}-${target}`;
	const cli = join(scratch, `cli-${v}`, top, "bin");
	mkdirSync(cli, { recursive: true });
	mkdirSync(dir, { recursive: true });
	let archive;
	if (win) {
		for (const name of ["pl", "prismalens"])
			writeFileSync(join(cli, `${name}.cmd`), `@echo ${v}\r\n`);
		archive = `${top}.zip`;
		execFileSync(
			join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
			["-a", "-cf", join(dir, archive), "-C", join(scratch, `cli-${v}`), top],
		);
	} else {
		for (const name of ["pl", "prismalens"])
			writeFileSync(join(cli, name), `#!/bin/sh\necho ${v}\n`, {
				mode: 0o755,
			});
		archive = `${top}.tar.gz`;
		execFileSync("tar", [
			"-czf",
			join(dir, archive),
			"-C",
			join(scratch, `cli-${v}`),
			top,
		]);
	}
	copyFileSync(zip, join(dir, asset));
	writeFileSync(
		join(dir, "SHA256SUMS"),
		`${[archive, asset].map((f) => `${sha256(join(dir, f))}  ${f}`).join("\n")}\n`,
	);
}
stage(older);
stage(version);

const server = createServer((req, res) => {
	const file = join(scratch, "release", decodeURIComponent(req.url ?? "/"));
	if (!file.startsWith(join(scratch, "release")) || !existsSync(file)) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { "content-length": statSync(file).size });
	if (req.method === "HEAD") res.end();
	else createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
writeFileSync(join(scratch, "userns-off"), "0\n");

const env = (v) => ({
	...process.env,
	HOME: home,
	PRISMALENS_RELEASE_BASE_URL: base,
	PRISMALENS_VERSION: v,
	PRISMALENS_DESKTOP: "1",
	PRISMALENS_NO_MODIFY_PATH: "1",
	NO_COLOR: "1",
	...(win
		? {
				PRISMALENS_HOME: join(scratch, "data"),
				PRISMALENS_INSTALL_BIN_DIR: join(scratch, "bin"),
			}
		: {
				XDG_DATA_HOME: join(home, ".local", "share"),
				// The smoke opens the app unsandboxed, so the launcher's AppArmor guard doesn't apply.
				PRISMALENS_USERNS_SYSCTL: join(scratch, "userns-off"),
			}),
});
// The installers print to stderr; capture it with the exit status.
const runInstaller = (args, v = version) => {
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
		{ env: env(v), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
	);
	let text = "";
	child.stdout.on("data", (d) => {
		text += d;
	});
	child.stderr.on("data", (d) => {
		text += d;
	});
	return new Promise((r) => child.on("exit", (code) => r({ code, text })));
};
const powershell = (command) =>
	execFileSync("powershell", ["-NoProfile", "-Command", command], {
		encoding: "utf8",
		windowsHide: true,
	}).trim();

const launcher = win
	? join(
			powershell("[Environment]::GetFolderPath('Programs')"),
			"PrismaLens.lnk",
		)
	: mac
		? join(home, "Applications", "PrismaLens.app")
		: join(home, ".local", "share", "applications", "prismalens.desktop");

const first = await runInstaller([], older);
check(first.code === 0, `${older} installed (${first.code})`);
check(
	first.text.includes("Desktop app installed"),
	`${older}'s install added the app, not skipped it`,
);
// Both releases carry one app build; a file only the old copy has shows the upgrade replaced it.
const installedApp = win
	? join(scratch, "data", "desktop", older)
	: mac
		? join(home, "Applications", "PrismaLens.app", "Contents")
		: join(home, ".local", "share", "prismalens", "desktop", "app");
const oldMark = join(installedApp, "smoke-older-copy");
writeFileSync(oldMark, older);
const upgraded = await runInstaller([]);
console.log(upgraded.text);
check(upgraded.code === 0, `the upgrade to ${version} exited 0`);
check(existsSync(launcher), `the launcher is at ${launcher}`);
check(!existsSync(oldMark), `the upgrade replaced ${older}'s app`);
check(upgraded.text.includes(launcher), "the final message names it");

const smokeEnv = {
	...process.env,
	PRISMALENS_DESKTOP_SMOKE: out,
	PRISMALENS_DESKTOP_SMOKE_LAUNCHER: "1",
	PRISMALENS_WORKSPACE_DIR: workspace,
	PRISMALENS_TELEMETRY: "off",
	HOME: home,
	...(win ? {} : { XDG_DATA_HOME: join(home, ".local", "share") }),
};
let open;
let entryBefore = "";
if (win) {
	const app = join(scratch, "data", "desktop", version, "PrismaLens.exe");
	// realpath gives both the long form: a runner's TEMP is an 8.3 path (RUNNER~1).
	const target = powershell(
		`(New-Object -ComObject WScript.Shell).CreateShortcut('${launcher}').TargetPath`,
	);
	check(
		existsSync(target) &&
			realpathSync.native(target).toLowerCase() ===
				realpathSync.native(app).toLowerCase(),
		`the shortcut opens ${version}: ${app}`,
	);
	check(
		!readdirSync(join(scratch, "data", "desktop")).includes(older),
		`the upgrade removed ${older}'s app`,
	);
	// `start` opens the .lnk as Explorer would, and the app inherits this environment.
	open = () =>
		spawn("cmd", ["/c", "start", '""', `"${launcher}"`], {
			env: smokeEnv,
			windowsVerbatimArguments: true,
			windowsHide: true,
		});
} else if (mac) {
	const plist = join(launcher, "Contents", "Info.plist");
	check(
		execFileSync("/usr/libexec/PlistBuddy", [
			"-c",
			"Print :CFBundleShortVersionString",
			plist,
		])
			.toString()
			.trim() === version,
		`the app in ~/Applications is ${version}`,
	);
	let quarantined = true;
	try {
		execFileSync("xattr", ["-p", "com.apple.quarantine", launcher], {
			stdio: "ignore",
		});
	} catch {
		quarantined = false;
	}
	check(
		!quarantined,
		"the app curl downloaded over HTTP has no quarantine flag, so its first open has no Gatekeeper prompt",
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
	entryBefore = readFileSync(launcher, "utf8");
	const exec = /^Exec=\/bin\/sh "([^"]+)"$/m.exec(entryBefore)?.[1];
	const icon = /^Icon=(.+)$/m.exec(entryBefore)?.[1];
	const desktopDir = join(home, ".local", "share", "prismalens", "desktop");
	check(exec === join(desktopDir, "launch"), `the entry runs ${exec}`);
	check(
		readFileSync(join(desktopDir, "launch"), "utf8").includes(
			`exec '${join(desktopDir, "app", "prismalens")}' "$@"`,
		),
		"its launcher opens the installed app",
	);
	check(
		!!icon && existsSync(icon) && statSync(icon).size > 1000,
		`the entry's icon is on disk: ${icon}`,
	);
	// A CI runner's Chromium sandbox helper is not setuid; the smoke runs unsandboxed there.
	open = () =>
		spawn("/bin/sh", [exec, "--no-sandbox"], {
			env: smokeEnv,
			stdio: "ignore",
		});
}

open();
const deadline = Date.now() + 180_000;
while (
	!(existsSync(out) && statSync(out).size > 10_000) &&
	Date.now() < deadline
)
	await wait(1000);
check(
	existsSync(out) && statSync(out).size > 10_000,
	`the app opened from its launcher and rendered ${basename(out)}`,
);
// The smoke capture quits the app; uninstall waits for its backend to let go.
const lock = join(workspace, "prismalens.lock");
for (let i = 0; i < 30 && existsSync(lock); i++) await wait(1000);
check(!existsSync(lock), "the app quit and released its workspace");
await wait(3000);

// The app's own launcher check ran on that start: it adds the AppUserModelID Windows
// notifications need to the installer's shortcut, and leaves the installer's entry as it is.
if (win)
	check(
		powershell(
			`$s = New-Object -ComObject Shell.Application; $f = $s.Namespace('${join(launcher, "..")}'); $f.ParseName('PrismaLens.lnk').ExtendedProperty('System.AppUserModel.ID')`,
		) === "io.prismalens.desktop",
		"the app gave its shortcut the AppUserModelID io.prismalens.desktop",
	);
else if (!mac)
	check(
		readFileSync(launcher, "utf8") === entryBefore,
		"the app left the installer's desktop entry byte for byte",
	);

const removed = await runInstaller([win ? "-Uninstall" : "--uninstall"]);
console.log(removed.text);
server.close();
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
