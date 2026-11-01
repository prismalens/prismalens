#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The protocol probe (#914, #1013): installs an agent from the channel its install hint names
 * and starts it as the product does (`detectAgent`, `planLaunch`, `probeAgent` from the built
 * `@prismalens/agent-host`), with no model behind it. It spends no tokens and warns no user.
 *
 *   agent-probe.mjs --all [--failures <file>] [--built <checkout>]
 *     each row at its channel's latest and at its pin; an adapter row runs the adapter
 *     `@prismalens/agent-adapters` ships, against the CLI's latest and its pin
 *   agent-probe.mjs --agent <id> --version <v> [--companion <v>] [--built <checkout>]
 *     one version, an adapter row's adapter from npm (the pin bump); exit 1 when it fails
 *
 * `--built` names the checkout whose `dist` folders to load, when this one's are not built.
 */
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const WINDOWS = process.platform === "win32";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PINS = JSON.parse(
	readFileSync(join(ROOT, "scripts/agent-pins.json"), "utf8"),
).pins;

/** Keys that get an agent past its own start-up key check; none ever reaches a model (#914). */
const PROBE_ENV = {
	codex: () => ({ CODEX_API_KEY: "probe-no-model" }),
	gemini: () => ({ GEMINI_API_KEY: "probe-no-model" }),
	// deepagents has no config-folder variable in the registry; its own empty profile instead.
	deepagents: (home) => ({
		OPENAI_API_KEY: "probe-no-model",
		DEEPAGENTS_HOME: home,
	}),
};

/** A row the probe hands no key, so asking for a sign-in is how it answers when it works. */
export const keyless = (id) => !PROBE_ENV[id];

const run = (file, args, options = {}) =>
	execFileSync(file, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: WINDOWS,
		...options,
	});

async function loadBuilt(checkout, withAdapters) {
	const load = (rel) => import(pathToFileURL(join(checkout, rel)).href);
	const host = await load("packages/@prismalens/agent-host/dist/index.js");
	const { HARNESS_REGISTRY } = await load(
		"packages/@prismalens/config/dist/providers/harness.js",
	);
	const adapters = withAdapters
		? await load("packages/@prismalens/agent-adapters/dist/index.js")
		: null;
	return { host, registry: HARNESS_REGISTRY, adapters };
}

/** The package a channel installs the CLI from: the npm name, or uv's first. */
export function channelPackage(channel) {
	return channel.npm ?? channel.uv[0];
}

const channelName = (channel) =>
	channel.npm ? `npm ${channel.npm}` : `uv ${channel.uv[0]}`;

/** The latest stable release on the channel. */
export async function latestOf(channel) {
	if (channel.npm) return run("npm", ["view", channel.npm, "version"]).trim();
	const res = await fetch(`https://pypi.org/pypi/${channel.uv[0]}/json`);
	if (!res.ok) throw new Error(`PyPI answered ${res.status}`);
	return (await res.json()).info.version;
}

/** One entry per version: a latest that is also the pin runs once. */
function atLatestAndPin(latest, pin, make) {
	if (!pin || pin === latest) return [make(latest, "latest, pin")];
	return [make(latest, "latest"), make(pin, "pin")];
}

/**
 * The probes `--all` runs: each row at its channel's latest and its pin, and its next major's
 * latest. An adapter row runs the shipped adapter, so the CLI's versions are what vary.
 */
export function plan(registry, pins, latest) {
	const out = [];
	for (const row of Object.values(registry)) {
		if (!row.channel) continue;
		const pkg = channelPackage(row.channel);
		if (row.adapterPackage)
			out.push(
				...atLatestAndPin(latest[pkg], pins[pkg], (companion, label) => ({
					id: row.id,
					channel: row.channel,
					adapter: "shipped",
					companion,
					label,
				})),
			);
		else
			out.push(
				...atLatestAndPin(latest[pkg], pins[pkg], (version, label) => ({
					id: row.id,
					channel: row.channel,
					version,
					label,
				})),
			);
		if (row.nextChannel)
			out.push({
				id: row.id,
				channel: row.nextChannel,
				version: latest[channelPackage(row.nextChannel)],
				label: "next major, latest",
			});
	}
	return out;
}

const npmInstall = (dir, specs) =>
	run("npm", [
		"install",
		"--prefix",
		dir,
		"--no-audit",
		"--no-fund",
		"--loglevel=error",
		...specs,
	]);

/** The script an installed package's `bin` names for `binary`. */
function binScript(prefix, pkg, binary) {
	const root = join(prefix, "node_modules", pkg);
	const { bin } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const rel =
		typeof bin === "string" ? bin : (bin[binary] ?? Object.values(bin)[0]);
	return join(root, rel);
}

/** Installs the probe's CLI from its channel under `dir`; returns the bin folder and any adapter. */
function install(built, row, probe, dir) {
	const { channel } = probe;
	if (row.adapterPackage) {
		let adapter;
		if (probe.adapter === "shipped") {
			adapter = built.adapters.shippedAdapter(row.adapterPackage);
			if (!adapter) throw new Error(`no shipped ${row.adapterPackage} built`);
		} else {
			const prefix = join(dir, "adapter");
			npmInstall(prefix, [`${row.adapterPackage}@${probe.adapter}`]);
			adapter = binScript(prefix, row.adapterPackage, row.binary);
		}
		const cli = join(dir, "cli");
		npmInstall(cli, [`${channel.npm}@${probe.companion}`]);
		return { bin: join(cli, "node_modules", ".bin"), adapter };
	}
	if (channel.npm) {
		npmInstall(dir, [`${channel.npm}@${probe.version}`]);
		return { bin: join(dir, "node_modules", ".bin") };
	}
	// uv fetches the Python the package needs when the runner has none.
	const venv = join(dir, "venv");
	run("uv", ["venv", "--quiet", "--python", "3.14", venv]);
	const bin = join(venv, WINDOWS ? "Scripts" : "bin");
	const [cli, ...extras] = channel.uv;
	run("uv", [
		"pip",
		"install",
		"--quiet",
		"--python",
		join(bin, WINDOWS ? "python.exe" : "python"),
		`${cli}==${probe.version}`,
		...extras,
	]);
	return { bin };
}

/** The host env with one PATH, whatever its case on Windows. */
function hostEnv(bin, extra) {
	const env = {};
	let path = "";
	for (const [k, v] of Object.entries(process.env)) {
		if (k.toUpperCase() === "PATH") path = v ?? "";
		else env[k] = v;
	}
	return { ...env, PATH: `${bin}${delimiter}${path}`, ...extra };
}

/**
 * One line for a probe result. `ok` when it answered ACP, or asked for a sign-in on a row
 * run with no key; a row handed a probe key that still asks has broken its start-up.
 */
export function verdict(result, { keyless: noKey }) {
	const ok =
		result.outcome === "answers-acp" ||
		(noKey && result.outcome === "sign-in-needed");
	const agent = result.agentInfo
		? `${result.agentInfo.name} ${result.agentInfo.version}`
		: "no agentInfo";
	const modes = result.modes?.available.length ?? 0;
	const text =
		result.outcome === "answers-acp"
			? `answers ACP (protocol ${result.protocolVersion}, ${agent}; ${modes} modes)`
			: `${result.outcome}${result.detail ? `: ${result.detail}` : ""}`;
	return { ok, text };
}

async function probeOne(built, probe) {
	const row = built.registry[probe.id];
	const dir = mkdtempSync(join(tmpdir(), `pl-probe-${row.id}-`));
	try {
		let installed;
		try {
			installed = install(built, row, probe, dir);
		} catch (e) {
			return {
				ok: false,
				text: `install failed: ${String(e.stderr || e.message)
					.trim()
					.slice(-200)}`,
			};
		}
		const { host } = built;
		const launch = host.detectAgent(row.id, {
			pathEnv: installed.bin,
			shippedAdapter: (pkg) =>
				pkg === row.adapterPackage ? (installed.adapter ?? null) : null,
		});
		if (!launch)
			return { ok: false, text: `not found after install in ${installed.bin}` };
		const home = join(dir, "home");
		mkdirSync(home);
		const runDir = join(dir, "run");
		const cwd = join(dir, "workspace");
		mkdirSync(cwd);
		const plan = host.planLaunch({
			agent: row.id,
			policy: {
				userSetup: "inherit",
				github: "exclude",
				floor: { mode: "inherit-minus-own-secrets", ownSecrets: {} },
			},
			launch,
			cwd,
			runDir,
			hostEnv: hostEnv(installed.bin, {
				...(row.configDir ? { [row.configDir.envKey]: home } : {}),
				...PROBE_ENV[row.id]?.(home),
			}),
		});
		host.writeLaunchFiles(plan);
		const result = await host.probeAgent({
			agent: row.id,
			command: plan.command,
			args: plan.args,
			cwd,
			env: plan.env,
			...(plan.sessionMeta ? { sessionMeta: plan.sessionMeta } : {}),
		});
		return verdict(result, { keyless: keyless(row.id) });
	} finally {
		try {
			rmSync(dir, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 500,
			});
		} catch {
			// A grandchild can hold a file open on Windows; the runner's temp dir is thrown away.
		}
	}
}

/** What a probe ran, in words: the adapter and CLI for an adapter row, else the version. */
export function shown(probe, shippedVersion) {
	if (!probe.adapter) return probe.version;
	const adapter =
		probe.adapter === "shipped"
			? `shipped adapter ${shippedVersion ?? "?"}`
			: `adapter ${probe.adapter}`;
	return `${adapter}, cli ${probe.companion}`;
}

async function main() {
	const { values } = parseArgs({
		options: {
			all: { type: "boolean" },
			agent: { type: "string" },
			version: { type: "string" },
			companion: { type: "string" },
			failures: { type: "string" },
			built: { type: "string" },
		},
	});
	const built = await loadBuilt(values.built ?? ROOT, Boolean(values.all));
	if (values.agent) {
		const row = built.registry[values.agent];
		if (!row?.channel || !values.version) {
			console.error(
				"usage: agent-probe.mjs --agent <id> --version <v> [--companion <v>]",
			);
			process.exit(2);
		}
		const probe = row.adapterPackage
			? {
					id: row.id,
					channel: row.channel,
					adapter: values.version,
					companion: values.companion ?? PINS[channelPackage(row.channel)],
				}
			: { id: row.id, channel: row.channel, version: values.version };
		const result = await probeOne(built, probe);
		console.log(`${row.id} ${shown(probe)}: ${result.text}`);
		process.exit(result.ok ? 0 : 1);
	}
	if (!values.all) {
		console.error("usage: agent-probe.mjs --all | --agent <id> --version <v>");
		process.exit(2);
	}
	const latest = {};
	for (const row of Object.values(built.registry))
		for (const channel of [row.channel, row.nextChannel].filter(Boolean)) {
			try {
				latest[channelPackage(channel)] = await latestOf(channel);
			} catch {
				latest[channelPackage(channel)] = "unknown";
			}
		}
	const lines = [
		`| Agent | Channel | Version | Tested | Probe (${process.platform}; initialize, session/new; no model) |`,
		"| :--- | :--- | :--- | :--- | :--- |",
	];
	const failed = [];
	for (const probe of plan(built.registry, PINS, latest)) {
		const row = built.registry[probe.id];
		const result = await probeOne(built, probe);
		const what = shown(
			probe,
			row.adapterPackage && built.adapters.shippedVersion(row.adapterPackage),
		);
		lines.push(
			`| ${row.id} | ${channelName(probe.channel)} | ${what} (${probe.label}) | ${row.tested?.version ?? "none"} | ${result.ok ? "ok" : "FAILS"}: ${result.text} |`,
		);
		if (!result.ok)
			failed.push(
				`${row.id}\t${channelName(probe.channel)} ${what} (${probe.label})\t${result.text.replace(/\s+/g, " ")}`,
			);
	}
	const table = lines.join("\n");
	console.log(table);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
	if (values.failures)
		appendFileSync(values.failures, failed.map((f) => `${f}\n`).join(""));
	// An agent's grandchildren can outlive the kill and hold the event loop open.
	process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
