#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Answers the Case File capture argv from scripts/fakes/kubectl/<scenario>/*.json.
// `{{now}}` and `{{now-30m}}` in a fixture become ISO times relative to the call,
// so a rollout stays inside the window before an alert fired a moment ago.
import {
	appendFileSync,
	chmodSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const KUBECTL_FIXTURES_DIR = join(HERE, "kubectl");
export const FAKE_KUBECTL_PATH = fileURLToPath(import.meta.url);
export const KUBECTL_SCENARIOS = [
	"crashloop",
	"rollout-before-alert",
	"forbidden",
	"slow",
	"huge-logs",
];

/** @param {string} binDir */
export function argvLogPath(binDir) {
	return join(binDir, "kubectl.argv.log");
}

/**
 * Writes an executable `kubectl` into `binDir` that plays `scenario`; each call's
 * argv is appended to `<binDir>/kubectl.argv.log`. Installing again switches scenario.
 * @param {string} binDir
 * @param {import("./fake-kubectl.d.mts").KubectlScenario} scenario
 */
export function installFakeKubectl(binDir, scenario) {
	if (!KUBECTL_SCENARIOS.includes(scenario))
		throw new Error(`fake-kubectl: no scenario ${scenario}`);
	const target = join(binDir, "kubectl");
	const args = `--scenario "${scenario}" --log "${argvLogPath(binDir)}"`;
	writeFileSync(
		target,
		`#!/bin/sh\nexec "${process.execPath}" "${FAKE_KUBECTL_PATH}" ${args} "$@"\n`,
	);
	chmodSync(target, 0o755);
	writeFileSync(
		`${target}.cmd`,
		`@echo off\r\n"${process.execPath}" "${FAKE_KUBECTL_PATH}" ${args} %*\r\n`,
	);
	return target;
}

/** @param {string} binDir @returns {string[][]} */
export function readArgvLog(binDir) {
	const file = argvLogPath(binDir);
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** @param {string} text @param {number} now */
function fillTimes(text, now) {
	return text.replace(/\{\{now(?:-(\d+)([smhd]))?\}\}/g, (_m, n, unit) =>
		new Date(
			now - (n ? Number(n) * UNIT_MS[/** @type {"s"} */ (unit)] : 0),
		).toISOString(),
	);
}

/** Flags whose value is the next argv element; every other flag is `--x` or `--x=v`. */
const VALUE_FLAGS = new Set(["--context", "--namespace", "-n", "-c", "-o"]);

/** @param {string[]} argv */
function parse(argv) {
	/** @type {Record<string, string>} */
	const flags = {};
	/** @type {string[]} */
	const words = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (VALUE_FLAGS.has(arg)) flags[arg] = argv[++i] ?? "";
		else if (arg.startsWith("-")) {
			const eq = arg.indexOf("=");
			if (eq > -1) flags[arg.slice(0, eq)] = arg.slice(eq + 1);
			else flags[arg] = "true";
		} else words.push(arg);
	}
	return { flags, words };
}

/**
 * @typedef {{ context?: string; server?: string; user?: string; namespace?: string;
 *   data?: string; delayMs?: number; whoami?: { username: string; groups?: string[] } | null;
 *   fail?: { get?: { stderr: string; exit?: number }; logs?: { stderr: string; exit?: number } };
 *   logs?: { lines?: string[]; padToBytes?: number } }} ScenarioFile
 */

function run() {
	const argv = process.argv.slice(2);
	/** @type {Record<string, string>} */
	const own = {};
	// The wrapper's own flags come first; everything after is kubectl's argv.
	while (argv[0] === "--scenario" || argv[0] === "--log") {
		const [flag, value] = argv.splice(0, 2);
		own[flag] = value ?? "";
	}
	const name = own["--scenario"] ?? "rollout-before-alert";
	if (own["--log"]) appendFileSync(own["--log"], `${JSON.stringify(argv)}\n`);

	const dir = join(KUBECTL_FIXTURES_DIR, name);
	/** @type {ScenarioFile} */
	const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8"));
	const context = scenario.context ?? "kind-pl";
	const namespace = scenario.namespace ?? "shop";
	const dataDir = join(KUBECTL_FIXTURES_DIR, scenario.data ?? name);
	const now = Date.now();
	const { flags, words } = parse(argv);
	const [verb, sub] = words;

	const out = (/** @type {unknown} */ v) =>
		process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
	const fail = (/** @type {string} */ stderr, exit = 1) => {
		process.stderr.write(`${stderr}\n`);
		process.exit(exit);
	};
	const list = (/** @type {string} */ kind) => {
		const file = join(dataDir, `${kind}.json`);
		if (!existsSync(file)) return { apiVersion: "v1", kind: "List", items: [] };
		return JSON.parse(fillTimes(readFileSync(file, "utf8"), now));
	};
	const contextOk = () => {
		const asked = flags["--context"];
		if (asked !== undefined && asked !== context)
			fail(`error: context "${asked}" does not exist`);
	};
	// Only calls that would reach the cluster are slow; kubeconfig reads are local.
	const remote = (/** @type {() => void} */ answer) =>
		setTimeout(answer, scenario.delayMs ?? 0);

	if (verb === "version") {
		out({ clientVersion: { gitVersion: "v1.31.0" } });
	} else if (verb === "config" && sub === "get-contexts") {
		out(`${context}\n`);
	} else if (verb === "config" && sub === "current-context") {
		out(`${context}\n`);
	} else if (verb === "config" && sub === "view") {
		contextOk();
		out({
			kind: "Config",
			"current-context": context,
			contexts: [
				{
					name: context,
					context: {
						cluster: context,
						user: scenario.user ?? context,
						namespace,
					},
				},
			],
			clusters: [
				{
					name: context,
					cluster: { server: scenario.server ?? "https://127.0.0.1:6443" },
				},
			],
			users: [{ name: scenario.user ?? context, user: {} }],
		});
	} else if (verb === "auth" && sub === "whoami") {
		contextOk();
		remote(() => {
			const who =
				scenario.whoami === undefined
					? { username: "kubernetes-admin", groups: ["system:masters"] }
					: scenario.whoami;
			if (who === null)
				fail('error: unknown command "whoami" for "kubectl auth"');
			out({ kind: "SelfSubjectReview", status: { userInfo: who } });
		});
	} else if (verb === "get") {
		contextOk();
		remote(() => {
			if (scenario.fail?.get)
				fail(scenario.fail.get.stderr, scenario.fail.get.exit ?? 1);
			const asked = flags["--namespace"] ?? flags["-n"] ?? namespace;
			const body =
				asked === namespace
					? list(sub)
					: { apiVersion: "v1", kind: "List", items: [] };
			if (flags["-o"] === "name")
				out(
					body.items
						.map(
							(/** @type {{ metadata: { name: string } }} */ i) =>
								`pod/${i.metadata.name}\n`,
						)
						.join(""),
				);
			else out(body);
		});
	} else if (verb === "logs") {
		contextOk();
		remote(() => {
			if (scenario.fail?.logs)
				fail(scenario.fail.logs.stderr, scenario.fail.logs.exit ?? 1);
			let text = fillTimes((scenario.logs?.lines ?? []).join("\n"), now);
			const pad = scenario.logs?.padToBytes ?? 0;
			const line = `${new Date(now).toISOString()} log-line\n`;
			text = text ? `${text}\n` : "";
			if (pad > text.length)
				text += line.repeat(Math.ceil((pad - text.length) / line.length));
			// kubectl stops at --limit-bytes without saying so.
			const limit = Number(flags["--limit-bytes"] ?? Infinity);
			process.stdout.write(Buffer.from(text).subarray(0, limit));
		});
	} else {
		fail(`fake-kubectl: no answer for ${JSON.stringify(argv)}`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run();
