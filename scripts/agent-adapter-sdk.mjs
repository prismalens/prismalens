#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pins the claude-agent-sdk that @prismalens/agent-adapters ships to the version its pinned
 * adapters declare, since the bundle refuses a shipped SDK that differs from the adapter's
 * (#913). The rolling pin-bump PR runs it after an adapter pin moves (#914).
 *
 *   agent-adapter-sdk.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SDK = "@anthropic-ai/claude-agent-sdk";
const ADAPTER = /^@agentclientprotocol\/.+-acp$/;
const PKG = join(
	dirname(fileURLToPath(import.meta.url)),
	"../packages/@prismalens/agent-adapters/package.json",
);

/** The SDK version every adapter that declares one agrees on, or null when none does. */
export function wantedSdk(adapters, declared) {
	const versions = new Set(
		Object.entries(adapters)
			.filter(([name]) => ADAPTER.test(name))
			.map(([name, version]) => declared(name, version))
			.filter(Boolean),
	);
	if (versions.size > 1)
		throw new Error(
			`adapters declare different ${SDK} versions: ${[...versions].join(", ")}`,
		);
	return versions.size ? [...versions][0] : null;
}

const fromNpm = (name, version) =>
	execFileSync("npm", ["view", `${name}@${version}`, `dependencies.${SDK}`], {
		encoding: "utf8",
		shell: process.platform === "win32",
	}).trim() || null;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const raw = readFileSync(PKG, "utf8");
	const pkg = JSON.parse(raw);
	const want = wantedSdk(pkg.devDependencies, fromNpm);
	if (!want || pkg.dependencies[SDK] === want) {
		console.log(`${SDK} stays at ${pkg.dependencies[SDK]}`);
	} else {
		console.log(`${SDK}: ${pkg.dependencies[SDK]} -> ${want}`);
		pkg.dependencies[SDK] = want;
		writeFileSync(PKG, `${JSON.stringify(pkg, null, "\t")}\n`);
	}
}
