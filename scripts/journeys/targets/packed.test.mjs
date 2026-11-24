// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launcherCommand, runLauncher, upServer } from "./packed.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "packed-target-test-"));
const never = () => {};
const READY = `console.log("PrismaLens API running"); setInterval(() => {}, 1000);`;
const serve = (/** @type {string} */ script = READY) =>
	spawn(process.execPath, ["-e", script], {
		stdio: ["ignore", "pipe", "pipe"],
	});
const killPid = (/** @type {number | undefined} */ pid) => {
	if (pid)
		try {
			process.kill(pid);
		} catch {
			// already gone
		}
};

test("on Windows the launcher path and each argument are quoted into one command; elsewhere it runs directly", () => {
	assert.deepEqual(
		launcherCommand(
			"C:/Users/a b/pl-intake/node_modules/.bin/pl.cmd",
			["pair", "--workspace", "C:/Users/a b/workspace"],
			true,
		),
		{
			command:
				'"C:/Users/a b/pl-intake/node_modules/.bin/pl.cmd" pair --workspace "C:/Users/a b/workspace"',
			args: [],
			shell: true,
		},
	);
	assert.deepEqual(launcherCommand("/tmp/a b/pl", ["up"], false), {
		command: "/tmp/a b/pl",
		args: ["up"],
		shell: false,
	});
});

test("a launcher whose path holds a space starts with each argument intact", () => {
	const dir = join(scratch(), "with space");
	mkdirSync(dir);
	const win = process.platform === "win32";
	const bin = join(dir, win ? "pl.cmd" : "pl");
	writeFileSync(
		bin,
		win
			? "@echo off\r\necho first=%1\r\necho second=%2\r\n"
			: '#!/bin/sh\necho "first=$1"\necho "second=$2"\n',
	);
	chmodSync(bin, 0o755);
	const workspace = join(dir, "work space");
	const lines = runLauncher(bin, ["--version", workspace])
		.trim()
		.split(/\r?\n/);
	assert.deepEqual(lines, [
		"first=--version",
		win ? `second="${workspace}"` : `second=${workspace}`,
	]);
});

test("a restart after the target was cleaned up boots no replacement", async () => {
	const dir = scratch();
	const spawned = [];
	const up = upServer({
		logPath: join(dir, "up.log"),
		log: never,
		kill: killPid,
		spawnUp: () => {
			const proc = serve();
			spawned.push(proc);
			return proc;
		},
	});
	await up.boot();
	const restarting = up.restart();
	await up.stop();
	await assert.rejects(restarting, {
		message: "the packed target was cleaned up during restart",
	});
	assert.equal(spawned.length, 1);
});

test("a restart boots a replacement and keeps one log across both servers", async () => {
	const dir = scratch();
	let n = 0;
	const up = upServer({
		logPath: join(dir, "up.log"),
		log: never,
		kill: killPid,
		spawnUp: () => {
			n++;
			return serve(
				`console.log("PrismaLens API running #${n}"); setInterval(() => {}, 1000);`,
			);
		},
	});
	await up.boot();
	await up.restart();
	await up.stop();
	assert.equal(n, 2);
	const written = readFileSync(join(dir, "up.log"), "utf8");
	assert.match(written, /PrismaLens API running #1/);
	assert.match(written, /PrismaLens API running #2/);
});

test("a launcher the system cannot spawn rejects the boot with the cause", async () => {
	const dir = scratch();
	const up = upServer({
		logPath: join(dir, "up.log"),
		log: never,
		kill: killPid,
		spawnUp: () =>
			spawn(join(dir, "no-such-launcher"), ["up"], {
				stdio: ["ignore", "pipe", "pipe"],
			}),
	});
	await assert.rejects(
		up.boot(),
		/^Error: pl up did not start: spawn .*ENOENT/,
	);
	await up.stop();
});

test("a log that cannot be written rejects the boot instead of crashing the process", async () => {
	const dir = scratch();
	const logPath = join(dir, "missing-dir", "up.log");
	const up = upServer({
		logPath,
		log: never,
		kill: killPid,
		spawnUp: () =>
			serve(`console.log("starting"); setInterval(() => {}, 1000);`),
	});
	await assert.rejects(
		up.boot(),
		(/** @type {Error} */ e) =>
			e.message.startsWith(`writing ${logPath} failed: `) &&
			e.message.includes("ENOENT"),
	);
	await up.stop();
});

test("stop closes the log with the server's output in it, and a second stop does nothing", async () => {
	const dir = scratch();
	const up = upServer({
		logPath: join(dir, "up.log"),
		log: never,
		kill: killPid,
		spawnUp: () => serve(),
	});
	await up.boot();
	await up.stop();
	assert.match(
		readFileSync(join(dir, "up.log"), "utf8"),
		/PrismaLens API running/,
	);
	await up.stop();
});
