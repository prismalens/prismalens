// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	checkLocks,
	installLocked,
	LOCKS,
	lockName,
	lockProblems,
	PIN_SOAK_DAYS,
	PYTHON_PIN_CONSTRAINTS,
	PYTHON_PINS,
	readPins,
	resolvedAsOf,
} from "./agent-locks.mjs";
import { agentPins, pinFile } from "./agent-pins.mjs";

const REPO = join(import.meta.dirname, "..");
const SCRIPT = join(import.meta.dirname, "agent-locks.mjs");

/** A checkout holding the real pins and locks, to move a pin in. */
function fixtureRoot() {
	const root = mkdtempSync(join(tmpdir(), "pl-locks-fixture-"));
	mkdirSync(join(root, "scripts"), { recursive: true });
	for (const { agent } of agentPins())
		cpSync(join(REPO, pinFile(agent)), join(root, pinFile(agent)));
	cpSync(LOCKS, join(root, "scripts/agent-locks"), { recursive: true });
	return root;
}

const movePin = (root, pin, version) => {
	const { agent } = agentPins(root).find((p) => p.cli.package === pin);
	const file = join(root, pinFile(agent));
	const json = JSON.parse(readFileSync(file, "utf8"));
	json.cli.version = version;
	writeFileSync(file, JSON.stringify(json));
};

const checkCli = (root) =>
	spawnSync(process.execPath, [SCRIPT, "check", "--root", root], {
		encoding: "utf8",
	});

test("every agent pin.json has a lock at its version", () => {
	assert.deepEqual(checkLocks(readPins()), []);
});

test("a moved pin with its lock untouched fails the check, naming the stale entry", () => {
	const root = fixtureRoot();
	try {
		const pin = "@openai/codex";
		const before = readPins()[pin];
		movePin(root, pin, "99.0.0");
		const result = checkCli(root);
		assert.equal(result.status, 1);
		assert.equal(
			result.stderr,
			[
				`agent-locks/codex: package.json wants ${pin}@${before}, the pin is 99.0.0`,
				`agent-locks/codex: package-lock.json asks for ${pin}@${before}, the pin is 99.0.0`,
				`agent-locks/codex: package-lock.json resolves ${pin} to ${before}, the pin is 99.0.0`,
				"Run `node scripts/agent-locks.mjs regen` and commit scripts/agent-locks.",
				"",
			].join("\n"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the check passes on a fixture whose pins did not move", () => {
	const root = fixtureRoot();
	try {
		const result = checkCli(root);
		assert.equal(result.status, 0);
		assert.equal(
			result.stdout,
			`agent-locks: ${Object.keys(readPins()).length} locks at their pins\n`,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a moved Python pin fails the check on its requirements.lock", () => {
	const root = fixtureRoot();
	try {
		movePin(root, "deepagents-code", "99.0.0");
		const result = checkCli(root);
		assert.equal(result.status, 1);
		assert.equal(
			result.stderr,
			[
				`agent-locks/deepagents-code: requirements.lock has deepagents-code==${readPins()["deepagents-code"]}, the pin is 99.0.0`,
				"Run `node scripts/agent-locks.mjs regen` and commit scripts/agent-locks.",
				"",
			].join("\n"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a pin with no lock folder, and a lock folder with no pin, are both stale", () => {
	const root = fixtureRoot();
	try {
		rmSync(join(root, "scripts/agent-locks/gemini-cli"), { recursive: true });
		mkdirSync(join(root, "scripts/agent-locks/retired-agent"));
		const result = checkCli(root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /^agent-locks\/gemini-cli: no lock folder$/m);
		assert.match(
			result.stderr,
			/^agent-locks\/retired-agent: has no agent pin\.json$/m,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a lock folder missing its files names each one", () => {
	assert.deepEqual(lockProblems("opencode-ai", "1.0.0", {}), [
		"package.json is missing",
		"package-lock.json is missing",
	]);
	assert.deepEqual(lockProblems("deepagents-code", "0.1.0", {}), [
		"requirements.lock is missing",
	]);
});

test("a Python lock matches on the whole pinned name, not a package that ends with it", () => {
	assert.deepEqual(
		lockProblems("deepagents-code", "0.1.0", {
			"requirements.lock": "not-deepagents-code==0.1.0 \\\n",
		}),
		["requirements.lock has deepagents-code==nothing, the pin is 0.1.0"],
	);
});

test("lock folders are named for the package without its scope", () => {
	assert.equal(lockName("@anthropic-ai/claude-code"), "claude-code");
	assert.equal(lockName("opencode-ai"), "opencode-ai");
});

test("a lock resolves its dependencies as of the pin's release plus the soak (#1085)", () => {
	assert.equal(PIN_SOAK_DAYS, 3);
	assert.equal(
		resolvedAsOf("2026-10-23T17:05:35.357726Z"),
		"2026-10-26T17:05:35.357Z",
	);
});

test("installing a pin whose lock is stale throws instead of installing the old version", () => {
	const into = mkdtempSync(join(tmpdir(), "pl-locks-into-"));
	const locked = readPins()["opencode-ai"];
	try {
		assert.throws(
			() =>
				installLocked("opencode-ai", into, LOCKS, { "opencode-ai": "99.0.0" }),
			{
				message: [
					`agent-locks/opencode-ai: package.json wants opencode-ai@${locked}, the pin is 99.0.0`,
					`agent-locks/opencode-ai: package-lock.json asks for opencode-ai@${locked}, the pin is 99.0.0`,
					`agent-locks/opencode-ai: package-lock.json resolves opencode-ai to ${locked}, the pin is 99.0.0`,
				].join("; "),
			},
		);
	} finally {
		rmSync(into, { recursive: true, force: true });
	}
});

test("the Python extras the lock installs are the uv channel the install hint names", async () => {
	const { channelOf } = await import(
		"../packages/@prismalens/providers/src/agent/family.ts"
	);
	const pypi = agentPins().filter((p) => p.cli.channel === "pypi");
	assert.deepEqual(
		pypi.map((p) => channelOf(p)),
		pypi.map((p) => ({ uv: [p.cli.package, ...PYTHON_PINS[p.cli.package]] })),
	);
	assert.deepEqual(
		pypi.map((p) => p.agent),
		["deepagents"],
	);
});

test("every pinned install in a workflow comes from its lock, never from the registry", () => {
	for (const file of ["proofs.yml", "nightly.yml", "agent-bump.yml"]) {
		const text = readFileSync(join(REPO, ".github/workflows", file), "utf8");
		assert.match(text, /node scripts\/agent-locks\.mjs install /);
		assert.doesNotMatch(text, /--before|--exclude-newer|uv tool install/);
		assert.doesNotMatch(text, /npm install -g "(\$PIN|opencode-ai)@/);
	}
});

test("a Python lock carries the pin's constraints the channel leaves uncapped", () => {
	for (const [pin, constraints] of Object.entries(PYTHON_PIN_CONSTRAINTS)) {
		const wants = readFileSync(
			join(LOCKS, lockName(pin), "requirements.in"),
			"utf8",
		).split("\n");
		for (const c of constraints) assert.ok(wants.includes(c), `${pin}: ${c}`);
	}
	assert.deepEqual(PYTHON_PIN_CONSTRAINTS, {
		"deepagents-code": ["agent-client-protocol<1"],
	});
});
