// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The packed and live targets: the published tarball, installed through the npm launcher
 * from a local release mirror (#717) and booted with `pl up` in a fresh workspace, which
 * a journey drives over HTTP. `packed` runs the scripted fake ACP agent as `opencode`
 * (#884); `live` runs whatever agent is on PATH, the pinned OpenCode in the nightly tier.
 */
import { execFileSync, spawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { installFakeAgent } from "../../fakes/fake-acp-agent.mjs";
import { prepareLauncher, tarballVersion } from "../../lib/launcher-mirror.mjs";
import { installWithRetry } from "../../lib/npm-install-retry.mjs";

/** @import { Target } from "../types.mjs" */

const FETCH_TIMEOUT_MS = 10_000;
const BOOT_TIMEOUT_MS = 120_000;
const WIN = process.platform === "win32";

/**
 * What the environment asks for. `PACKED_INTAKE_AGENT=live` (the default) runs the agent on
 * PATH; `fake` runs the scripted one and needs the built-in fixture repo its session cites.
 * @param {Record<string, string | undefined>} env
 */
export function packedConfig(env) {
	const agent = env.PACKED_INTAKE_AGENT ?? "live";
	if (agent !== "live" && agent !== "fake") {
		throw new Error(`PACKED_INTAKE_AGENT must be live or fake, got ${agent}`);
	}
	const repo = env.PACKED_INTAKE_REPO;
	if (agent === "fake" && repo && repo !== "fixture") {
		throw new Error(
			"PACKED_INTAKE_AGENT=fake needs PACKED_INTAKE_REPO=fixture",
		);
	}
	/** @type {Pick<Target, "name" | "agent">} */
	const kind =
		agent === "live"
			? { name: "live", agent: "real" }
			: { name: "packed", agent: "scripted" };
	return {
		...kind,
		/** A checkout to investigate; absent: the built-in fixture. */
		repo: repo && repo !== "fixture" ? resolve(repo) : undefined,
		port: env.PACKED_INTAKE_PORT ?? "3102",
		model: env.PRISMALENS_HARNESS_MODEL,
		journeys: env.PACKED_INTAKE_JOURNEYS
			? env.PACKED_INTAKE_JOURNEYS.split(",").map((s) => s.trim())
			: null,
		eventsOut: env.PACKED_INTAKE_EVENTS_OUT,
	};
}

/**
 * The tarball `pack-cli.mjs` wrote: PRISMALENS_TARBALL, else the one in `dir`.
 * @param {string | undefined} dir
 * @param {Record<string, string | undefined>} env
 */
export function findTarball(dir, env) {
	if (env.PRISMALENS_TARBALL) return resolve(env.PRISMALENS_TARBALL);
	if (!dir) {
		throw new Error(
			"usage: packed-intake.mjs <dir-with-tarball> (or set PRISMALENS_TARBALL)",
		);
	}
	const tarballsDir = resolve(dir);
	const found = readdirSync(tarballsDir).find((f) =>
		/^prismalens-[0-9].*\.tgz$/.test(f),
	);
	if (!found)
		throw new Error(`no tarball matching prismalens-*.tgz in ${tarballsDir}`);
	return join(tarballsDir, found);
}

// The API leads each ACP agent in its own process group, so killing `pl up` alone
// orphans it; walk by parent pid instead (#904). pgrep: Linux runners only.
function descendantPids(/** @type {number} */ root) {
	/** @type {number[]} */
	const found = [];
	/** @type {number[]} */
	const queue = [root];
	while (queue.length > 0) {
		let out = "";
		try {
			out = execFileSync("pgrep", ["-P", String(queue.shift())], {
				encoding: "utf8",
			});
		} catch {
			continue;
		}
		for (const line of out.split("\n")) {
			const pid = Number(line);
			if (pid > 0) {
				found.push(pid);
				queue.push(pid);
			}
		}
	}
	return found;
}

function killTree(/** @type {number | undefined} */ pid) {
	if (!pid) return;
	if (WIN) {
		try {
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
			});
		} catch {
			// already gone
		}
		return;
	}
	for (const p of [...descendantPids(pid).reverse(), pid]) {
		try {
			process.kill(p, "SIGKILL");
		} catch {
			// already gone
		}
	}
}

const sleep = (/** @type {number} */ ms) =>
	new Promise((r) => setTimeout(r, ms));

/**
 * How to start the `pl` launcher. On Windows it is a .cmd shim that only a shell starts, and a shell takes
 * one string, so the path and every argument are quoted into it; elsewhere it runs directly.
 * @param {string} bin
 * @param {string[]} args
 * @param {boolean} [win]
 */
export function launcherCommand(bin, args, win = WIN) {
	if (!win) return { command: bin, args, shell: false };
	const quote = (/** @type {string} */ a) =>
		a === "" || /\s/.test(a) ? `"${a}"` : a;
	return {
		command: [bin, ...args].map(quote).join(" "),
		args: [],
		shell: true,
	};
}

/**
 * Runs the launcher to its end and returns its stdout.
 * @param {string} bin
 * @param {string[]} args
 * @param {{ timeout?: number }} [options]
 */
export function runLauncher(bin, args, options = {}) {
	const { command, args: rest, shell } = launcherCommand(bin, args);
	return execFileSync(command, rest, { encoding: "utf8", shell, ...options });
}

/**
 * One `pl up` across boots and restarts. A spawn failure or a log write failure rejects the boot, so the
 * target's cleanup runs; `stop` kills the tree, closes the log once, and no later boot starts (#1154).
 * @param {{
 *   spawnUp: () => import("node:child_process").ChildProcess,
 *   logPath: string,
 *   log: (message: string) => void,
 *   kill?: (pid: number | undefined) => void,
 *   readyTimeoutMs?: number,
 *   stopTimeoutMs?: number,
 * }} p
 */
export function upServer({
	spawnUp,
	logPath,
	log,
	kill = killTree,
	readyTimeoutMs = BOOT_TIMEOUT_MS,
	stopTimeoutMs = 30_000,
}) {
	/** @type {import("node:child_process").ChildProcess | undefined} */
	let child;
	let stopped = false;
	/** @type {Error | undefined} */
	let logError;
	const logStream = createWriteStream(logPath);
	logStream.on("error", (e) => {
		logError = e;
	});

	const boot = async () => {
		let bootLog = "";
		/** @type {Error | undefined} */
		let spawnError;
		const proc = spawnUp();
		child = proc;
		proc.on("error", (e) => {
			spawnError = e;
		});
		for (const stream of [proc.stdout, proc.stderr]) {
			stream?.on("data", (d) => {
				bootLog += d;
				if (!logStream.writableEnded && !logStream.destroyed)
					logStream.write(d);
			});
		}
		const start = Date.now();
		while (!/PrismaLens API running/.test(bootLog)) {
			if (stopped) throw new Error("the packed target was cleaned up");
			if (spawnError)
				throw new Error(`pl up did not start: ${spawnError.message}`);
			if (logError)
				throw new Error(`writing ${logPath} failed: ${logError.message}`);
			if (proc.exitCode !== null || Date.now() - start > readyTimeoutMs) {
				console.error(`----- boot log -----
${bootLog.slice(-4000)}`);
				throw new Error(
					`pl up did not report ready within ${readyTimeoutMs / 1000}s`,
				);
			}
			await sleep(50);
		}
		log("pl up is ready");
	};

	return {
		boot,
		/** Kills `pl up`, waits for it to end, then boots a replacement unless the target was cleaned up. */
		async restart() {
			const old = child;
			kill(old?.pid);
			const start = Date.now();
			while (old && old.exitCode === null && old.signalCode === null) {
				if (Date.now() - start > stopTimeoutMs)
					throw new Error(
						`pl up did not stop within ${stopTimeoutMs / 1000}s of the kill`,
					);
				await sleep(50);
			}
			if (stopped)
				throw new Error("the packed target was cleaned up during restart");
			await boot();
		},
		async stop() {
			if (stopped) return;
			stopped = true;
			kill(child?.pid);
			if (!logStream.destroyed)
				await new Promise((done) => logStream.end(() => done(undefined)));
		},
	};
}

/**
 * Installs the tarball's launcher, boots `pl up` and pairs a device.
 * @param {ReturnType<typeof packedConfig> & { tgz: string }} config
 * @param {(message: string) => void} [log]
 * @returns {Promise<Target>}
 */
export async function openPackedTarget(config, log = console.log) {
	const prefix = mkdtempSync(join(tmpdir(), "pl-intake-"));
	const workspace = join(prefix, "workspace");
	const workDir = join(prefix, "journeys");
	mkdirSync(workspace, { recursive: true });
	mkdirSync(workDir);
	const base = `http://127.0.0.1:${config.port}`;
	/** @type {ReturnType<typeof upServer> | undefined} */
	let server;
	let cookie = "";
	let cleaned = false;

	const cleanup = async () => {
		if (cleaned) return;
		cleaned = true;
		await server?.stop();
		rmSync(prefix, { recursive: true, force: true });
	};

	try {
		const version = tarballVersion(config.tgz);
		log(`tarball: ${config.tgz}`);
		const release = prepareLauncher({
			tgz: config.tgz,
			work: join(prefix, "release"),
			releases: [{ version, launcher: true }],
		});
		log(
			`installing the launcher ${version} into ${prefix}; archive from ${release.baseUrl}`,
		);
		const install = [
			"install",
			"--prefix",
			prefix,
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
			release.launchers[version],
		];
		// npm is a .cmd shim on Windows, which only a shell starts; a shell takes one string.
		if (WIN)
			installWithRetry(
				["npm", ...install].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "),
				[],
				{ shell: true },
			);
		else installWithRetry("npm", install);

		const bin = join(prefix, "node_modules", ".bin", WIN ? "pl.cmd" : "pl");
		if (!existsSync(bin)) throw new Error(`pl bin not linked at ${bin}`);
		const launcherEnv = {
			PRISMALENS_RELEASE_BASE_URL: release.baseUrl,
			PRISMALENS_LAUNCHER_DIR: join(prefix, "launcher-cache"),
		};
		Object.assign(process.env, launcherEnv);
		const printed = runLauncher(bin, ["--version"], {
			timeout: 600_000,
		}).trim();
		if (printed !== version)
			throw new Error(
				`the launcher's first run printed ${printed}, not ${version}`,
			);
		log(`the launcher unpacked ${version}`);

		let agentPath = process.env.PATH ?? "";
		if (config.agent === "scripted") {
			const agentBin = join(prefix, "agent-bin");
			mkdirSync(agentBin);
			installFakeAgent(agentBin, {
				session: "intake",
				binaries: ["opencode"],
				stateDir: join(prefix, "fake-agent-state"),
			});
			agentPath = `${agentBin}${delimiter}${agentPath}`;
			log("agent: scripted fake as opencode");
		}

		const up = upServer({
			logPath: join(prefix, "up.log"),
			log,
			spawnUp: () => {
				log(`pl up on ${base} (workspace ${workspace})`);
				const { command, args, shell } = launcherCommand(bin, ["up"]);
				return spawn(command, args, {
					shell,
					stdio: ["ignore", "pipe", "pipe"],
					env: {
						...process.env,
						CI: process.env.CI ?? "true",
						// Keeps an exported `off`; otherwise a local run counts as internal (#1021).
						PRISMALENS_TELEMETRY:
							process.env.PRISMALENS_TELEMETRY || "internal",
						PATH: agentPath,
						PRISMALENS_WORKSPACE_DIR: workspace,
						// The default (quiet) console level keeps the readiness line out of stdout (#610).
						PRISMALENS_LOG_CONSOLE: "verbose",
						PRISMALENS_HOST: "127.0.0.1",
						PRISMALENS_PORT: config.port,
						...launcherEnv,
					},
				});
			},
		});
		server = up;
		await up.boot();

		/** @param {string} path @param {RequestInit} [init] */
		const raw = (path, init) =>
			fetch(base + path, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				...init,
				headers: {
					"content-type": "application/json",
					origin: base,
					...(init?.headers ?? {}),
				},
			});
		cookie = await pairDevice({ bin, workspace, raw, log });

		/** @type {Target["api"]} */
		const api = async (path, init = {}) => {
			const res = await raw(`/api${path}`, {
				method: init.method ?? "GET",
				headers: { cookie },
				body: init.body === undefined ? undefined : JSON.stringify(init.body),
			});
			const text = await res.text();
			if (!res.ok)
				throw new Error(
					`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
				);
			return JSON.parse(text || "null");
		};

		if (config.model) await setModel(api, config.model, log);

		return {
			name: config.name,
			agent: config.agent,
			baseUrl: base,
			workDir,
			workspace,
			...(config.repo ? { repo: config.repo } : {}),
			runTimeoutMs: config.agent === "real" ? 600_000 : 180_000,
			api,
			sendAlert: (body) =>
				raw("/api/webhooks/prometheus", {
					method: "POST",
					headers: {
						authorization: `Bearer ${readFileSync(join(workspace, "PRISMALENS_WEBHOOK_SECRET_FILE"), "utf8").trim()}`,
					},
					body: JSON.stringify(body),
				}),
			restart: () => up.restart(),
			cleanup,
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}

/**
 * Pairs a device the way an operator does, `pl pair`, and checks what the pairing promises.
 * @param {{ bin: string, workspace: string, raw: (path: string, init?: RequestInit) => Promise<Response>, log: (m: string) => void }} p
 * @returns {Promise<string>} the device cookie
 */
async function pairDevice({ bin, workspace, raw, log }) {
	const pairOut = runLauncher(bin, [
		"pair",
		"--start-runs",
		"--workspace",
		workspace,
	]);
	const token = pairOut.match(/\/pair#([^\s#]+)/)?.[1] ?? "";
	const redeem = () =>
		raw("/api/pairing/redeem", {
			method: "POST",
			body: JSON.stringify({ token, name: "packed intake" }),
		});

	const first = await redeem();
	const setCookie = first.headers.getSetCookie?.() ?? [];
	const deviceCookie = setCookie.find((c) =>
		c.startsWith("prismalens.device."),
	);
	const cookie = deviceCookie ? deviceCookie.split(";")[0] : "";
	if (first.status !== 200 || !cookie) {
		throw new Error(
			`POST /api/pairing/redeem failed: status ${first.status}, cookies ${setCookie.length}`,
		);
	}
	log("OK   POST /api/pairing/redeem 200 with device cookie");

	const withCookie = await raw("/api/operator/whoami", { headers: { cookie } });
	const withBody = await withCookie.json().catch(() => ({}));
	if (withCookie.status !== 200 || withBody.via !== "device") {
		throw new Error(
			`GET /api/operator/whoami with cookie failed: status ${withCookie.status}, via ${withBody.via}`,
		);
	}
	const without = await raw("/api/operator/whoami");
	const withoutBody = await without.json().catch(() => ({}));
	if (without.status !== 200 || withoutBody.via !== null) {
		throw new Error(
			`GET /api/operator/whoami without cookie failed: status ${without.status}, via ${withoutBody.via}`,
		);
	}
	log(
		"OK   GET /api/operator/whoami says device with the cookie, null without",
	);

	const again = await redeem();
	if (again.status !== 400) {
		throw new Error(
			`POST /api/pairing/redeem again failed: status ${again.status}`,
		);
	}
	const devices = await raw("/api/pairing/devices", { headers: { cookie } });
	if (devices.status !== 403) {
		throw new Error(
			`GET /api/pairing/devices with device cookie failed: status ${devices.status}`,
		);
	}
	log("OK   a link redeems once, and a device cannot list devices");
	return cookie;
}

/**
 * The model is stored per harness, so it goes under the one auto selects.
 * @param {Target["api"]} api
 * @param {string} model
 * @param {(message: string) => void} log
 */
async function setModel(api, model, log) {
	const harness = (await api("/settings/harnesses")).selection?.harness;
	if (!harness) {
		throw new Error(
			`GET /api/settings/harnesses named no harness to set ${model} on`,
		);
	}
	await api("/settings/harness", {
		method: "PATCH",
		body: { harness: "auto", models: { [harness]: model } },
	});
	log(`OK   PATCH /api/settings/harness ${harness} model=${model}`);
}
