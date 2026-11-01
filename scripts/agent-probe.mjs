#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The protocol probe (#914, #1013): installs an agent from the channel its install hint names
 * and starts it as the product does (`detectAgent`, `planLaunch`, `probeAgent` from the built
 * `@prismalens/agent-host`), with no model behind it. It spends no tokens and warns no user.
 *
 *   agent-probe.mjs --all [--failures <file>] [--built <checkout>]   every row at its channel's latest, and at its pin
 *   agent-probe.mjs --agent <id> --version <v> [--companion <v>] [--built <checkout>]   one version; exit 1 when it fails
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

const run = (file, args, options = {}) =>
	execFileSync(file, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: WINDOWS,
		...options,
	});

async function loadBuilt(checkout) {
	const load = (rel) => import(pathToFileURL(join(checkout, rel)).href);
	const host = await load("packages/@prismalens/agent-host/dist/index.js");
	const { HARNESS_REGISTRY } = await load(
		"packages/@prismalens/config/dist/providers/harness.js",
	);
	return { host, registry: HARNESS_REGISTRY };
}

/** The package a channel installs the CLI from: the npm name, or uv's first. */
export function channelPackage(channel) {
	return channel.npm ?? channel.uv[0];
}

/** The latest stable release on the channel. */
export async function latestOf(channel) {
	if (channel.npm) return run("npm", ["view", channel.npm, "version"]).trim();
	const res = await fetch(`https://pypi.org/pypi/${channel.uv[0]}/json`);
	if (!res.ok) throw new Error(`PyPI answered ${res.status}`);
	return (await res.json()).info.version;
}

/**
 * The probes `--all` runs: each row at its channel's latest, and at its pin when that differs.
 * An adapter row runs its latest adapter with the CLI at the channel's latest.
 */
export function plan(registry, pins, latest) {
	const out = [];
	for (const row of Object.values(registry)) {
		if (!row.channel) continue;
		const pkg = channelPackage(row.channel);
		const cli = latest[pkg];
		if (row.adapterPackage) {
			out.push({
				id: row.id,
				version: latest[row.adapterPackage],
				companion: cli,
				label: "latest",
			});
			continue;
		}
		const pin = pins[pkg];
		out.push({
			id: row.id,
			version: cli,
			label: pin === cli ? "latest, pin" : "latest",
		});
		if (pin && pin !== cli)
			out.push({ id: row.id, version: pin, label: "pin" });
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

/** The script an installed package's `bin` names for `binary`, as a product ships it. */
function binScript(prefix, pkg, binary) {
	const root = join(prefix, "node_modules", pkg);
	const { bin } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const rel =
		typeof bin === "string" ? bin : (bin[binary] ?? Object.values(bin)[0]);
	return join(root, rel);
}

/** Installs from the row's channel under `dir`; returns the bin folder and any shipped adapter. */
function install(row, version, companion, dir) {
	const { channel } = row;
	if (row.adapterPackage) {
		const adapter = join(dir, "adapter");
		npmInstall(adapter, [`${row.adapterPackage}@${version}`]);
		const cli = join(dir, "cli");
		npmInstall(cli, [`${channel.npm}@${companion}`]);
		return {
			bin: join(cli, "node_modules", ".bin"),
			adapter: binScript(adapter, row.adapterPackage, row.binary),
		};
	}
	if (channel.npm) {
		npmInstall(dir, [`${channel.npm}@${version}`]);
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
		`${cli}==${version}`,
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

/** One line for a probe result; `ok` when the agent started and answered ACP. */
export function verdict(result) {
	const ok =
		result.outcome === "answers-acp" || result.outcome === "sign-in-needed";
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
			installed = install(row, probe.version, probe.companion, dir);
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
		return verdict(result);
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

const shown = (p) =>
	p.companion ? `${p.version} (cli ${p.companion})` : p.version;

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
	const built = await loadBuilt(values.built ?? ROOT);
	if (values.agent) {
		const row = built.registry[values.agent];
		if (!row?.channel || !values.version) {
			console.error(
				"usage: agent-probe.mjs --agent <id> --version <v> [--companion <v>]",
			);
			process.exit(2);
		}
		const companion = row.adapterPackage
			? (values.companion ?? PINS[channelPackage(row.channel)])
			: undefined;
		const probe = { id: row.id, version: values.version, companion };
		const result = await probeOne(built, probe);
		console.log(`${row.id} ${shown(probe)}: ${result.text}`);
		process.exit(result.ok ? 0 : 1);
	}
	if (!values.all) {
		console.error("usage: agent-probe.mjs --all | --agent <id> --version <v>");
		process.exit(2);
	}
	const latest = {};
	for (const row of Object.values(built.registry)) {
		for (const [pkg, channel] of [
			...(row.channel ? [[channelPackage(row.channel), row.channel]] : []),
			...(row.adapterPackage
				? [[row.adapterPackage, { npm: row.adapterPackage }]]
				: []),
		]) {
			try {
				latest[pkg] = await latestOf(channel);
			} catch {
				latest[pkg] = "unknown";
			}
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
		const channel = row.channel.npm
			? `npm ${row.channel.npm}`
			: `uv ${row.channel.uv[0]}`;
		lines.push(
			`| ${row.id} | ${channel} | ${shown(probe)} (${probe.label}) | ${row.tested?.version ?? "none"} | ${result.ok ? "ok" : "FAILS"}: ${result.text} |`,
		);
		if (!result.ok)
			failed.push(
				`${row.id}\t${probe.version}\t${result.text.replace(/\s+/g, " ")}`,
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
