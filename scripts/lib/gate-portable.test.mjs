// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import {
	baseEnv,
	checksFor,
	homeDirs,
	killTree,
	notApplicable,
	resolveOnPath,
	systemDirs,
} from "./gate-portable.mjs";

const scratch = mkdtempSync(join(tmpdir(), "gate-portable-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const ALL = [
	"telemetry",
	"update",
	"lock",
	"reset",
	"hosts",
	"upgrade",
	"rollback",
];

test("rollback runs on Linux only; the other six run everywhere", () => {
	assert.deepEqual(checksFor(ALL, "linux"), ALL);
	for (const platform of ["win32", "darwin"]) {
		assert.deepEqual(checksFor(ALL, platform), ALL.slice(0, 6));
		assert.deepEqual(notApplicable(ALL, platform), ["rollback"]);
	}
	assert.deepEqual(notApplicable(ALL, "linux"), []);
});

test("the Windows PATH holds System32, the Windows dir and git's, each once, and not node's", () => {
	const root = join(scratch, "Windows");
	const dirs = systemDirs(
		"win32",
		{ SystemRoot: root },
		{ git: join(scratch, "Git", "cmd", "git.exe") },
	);
	assert.deepEqual(dirs, [
		join(root, "System32"),
		root,
		join(scratch, "Git", "cmd"),
	]);
	assert.equal(systemDirs("win32", { SystemRoot: root }).length, 2);
	assert.deepEqual(systemDirs("linux"), ["/usr/bin", "/bin"]);
	assert.deepEqual(systemDirs("darwin"), ["/usr/bin", "/bin"]);
});

test("the sandbox env names the throwaway home the way each OS reads it", () => {
	const home = join(scratch, "home");
	const tmp = join(scratch, "tmp");
	const posix = baseEnv({ platform: "linux", home, tmp, source: {} });
	assert.equal(posix.HOME, home);
	assert.equal(posix.LANG, "C.UTF-8");
	assert.equal(posix.USERPROFILE, undefined);
	const win = baseEnv({
		platform: "win32",
		home,
		tmp,
		source: { SystemRoot: join(scratch, "Windows") },
	});
	assert.equal(win.USERPROFILE, home);
	assert.equal(win.APPDATA, join(home, "AppData", "Roaming"));
	assert.equal(win.LOCALAPPDATA, join(home, "AppData", "Local"));
	assert.equal(win.TEMP, tmp);
	assert.equal(win.ComSpec, join(scratch, "Windows", "System32", "cmd.exe"));
	assert.equal(win.LANG, undefined);
	for (const env of [posix, win])
		for (const dir of homeDirs(env)) assert.ok(dir.startsWith(scratch), dir);
});

test("a binary is found by PATHEXT on Windows and by its exact name elsewhere", () => {
	const bin = join(scratch, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, "claude.cmd"), "@echo off\r\n");
	writeFileSync(join(bin, "codex"), "#!/bin/sh\n");
	const path = ["", bin].join(delimiter);
	assert.equal(
		resolveOnPath("claude", path, "win32", ".EXE;.CMD"),
		join(bin, "claude.cmd"),
	);
	assert.equal(resolveOnPath("claude", path, "linux"), null);
	assert.equal(resolveOnPath("codex", path, "linux"), join(bin, "codex"));
	assert.equal(resolveOnPath("gemini", path, "win32", ".EXE;.CMD"), null);
});

test("killTree on a missing pid or a gone process does not throw", () => {
	killTree(undefined, "SIGKILL");
	killTree(
		2 ** 22 + 7,
		"SIGKILL",
		process.platform === "win32" ? "linux" : process.platform,
	);
});
