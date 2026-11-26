// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The isolation rows (#1180 §0, R1, §3.4): seed marker hooks, plugins and MCP servers into the
 * agent's own home and the session's folder, fire them once with no isolation (the positive
 * control), then assert none fires under a check path (`probe`) or a clean-profile turn (`clean`).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_REGISTRY, versionOf } from "@prismalens/agent-host";
import type { HarnessId } from "@prismalens/config/harness";
import {
	configVar,
	rootKeys,
	scratchEnv,
	seedProject,
	seedUser,
} from "../../../../scripts/fakes/markers/seed.mjs";
import type { Row } from "../../../../scripts/fakes/scripted-model.mjs";
import {
	CheckNotIsolatedError,
	isolateCheck,
	probeHarness,
} from "../src/run/harness-doctor.js";
import { prepareRunEnv } from "../src/run/investigate.js";
import { readAgentLimits } from "../src/run/limits-read.js";
import { nameThread } from "../src/run/name-thread.js";
import { deny } from "../src/run/permission.js";
import { AcpSession } from "../src/runner/acp-client.js";

/** Server names PrismaLens would find in the agent's config files (§3.1), turned off by name. */
const FOUND_MCP = ["mk-user", "mk-project"];

/** The markers each launch left, then an empty folder for the next. */
function take(markers: string): string[] {
	const seen = readdirSync(markers).sort();
	for (const f of seen) rmSync(join(markers, f), { force: true });
	return seen;
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One session (and a turn when `turn`) on `harness` in `cwd`; a problem when it cannot run, else null. */
export async function isolatedSession(
	harness: HarnessId,
	env: NodeJS.ProcessEnv,
	cwd: string,
	profile: "own" | "probe" | "clean",
	turn: boolean,
): Promise<string | null> {
	const runDir = mkdtempSync(join(tmpdir(), "pl-matrix-iso-"));
	try {
		const prepared = prepareRunEnv({
			harness,
			cwd,
			runDir,
			hostEnv: env,
		});
		const rowMeta = AGENT_REGISTRY[harness].sessionMeta?.();
		const row = AGENT_REGISTRY[harness];
		const use =
			profile === "clean"
				? (row.cleanProfile ?? null)
				: profile === "probe"
					? (row.probeIsolation ?? null)
					: null;
		if (profile !== "own" && !use)
			return `the agent has no ${profile} isolation`;
		const plan = await isolateCheck(
			harness,
			{
				env: prepared.env,
				args: prepared.args,
				...(rowMeta ? { sessionMeta: rowMeta } : {}),
			},
			{
				requireIsolation: profile !== "own",
				probeIsolation: use,
				mcp: FOUND_MCP,
				runDir,
				versionOf: () =>
					versionOf(
						prepared.runEnv.companionPath ?? prepared.launch.command,
						undefined,
						prepared.env,
					),
			},
		);
		const s = new AcpSession({
			command: prepared.launch.command,
			args: plan.args,
			cwd,
			env: plan.env,
			...(plan.sessionMeta ? { sessionMeta: plan.sessionMeta } : {}),
			permission: (req) =>
				deny(req, "denied", "the isolation row refuses every ask"),
			initTimeoutMs: 60_000,
			promptTimeoutMs: 60_000,
		});
		try {
			await s.open();
			// A check never sends a turn; it is held open long enough for the agent to start its servers.
			if (!turn) await settle(5_000);
			else
				for await (const item of s.prompt("Say hello.")) {
					if (item.kind === "error")
						return `the ${profile} turn failed: ${item.message}`;
					if (item.kind === "done") break;
				}
		} finally {
			await s.close().catch(() => undefined);
		}
		return null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return err instanceof CheckNotIsolatedError
			? `no ${profile} isolation: ${message}`
			: `the ${profile} session failed: ${message}`;
	} finally {
		rmSync(runDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
	}
}

/** Runs one isolation row; a problem, or null on a pass, and what it saw. */
export async function runIsolationRow(
	row: Row,
	harness: HarnessId,
	given: NodeJS.ProcessEnv = process.env,
): Promise<{ problem: string | null; saw: string }> {
	const env = scratchEnv(harness, given);
	const key = configVar(harness);
	// The check, title and limit paths read the agent's folders from process.env.
	const before = Object.fromEntries(rootKeys().map((k) => [k, process.env[k]]));
	if (key) for (const k of rootKeys()) process.env[k] = env[k];
	const markers = mkdtempSync(join(tmpdir(), "pl-matrix-markers-"));
	const controls = row.markers?.[harness] ?? [];
	const seen: string[] = [];
	const seed = (cwd: string) => seedProject(harness, cwd, env, markers);
	try {
		seedUser(harness, env, markers);
		if (!controls.length)
			return {
				problem: `no positive control is declared for ${harness}`,
				saw: "",
			};
		const workspace = mkdtempSync(join(tmpdir(), "pl-matrix-iso-ws-"));
		const control = async () => {
			await isolatedSession(
				harness,
				env,
				workspace,
				"own",
				row.run.isolation === "clean",
			);
			await settle(1_000);
		};
		seed(workspace);
		await control();
		const fired = take(markers);
		seen.push(`own: ${fired.join(",") || "none"}`);
		const missing = controls.filter((m) => !fired.includes(m));
		if (missing.length)
			return {
				problem: `the positive control did not fire ${missing.join(",")}`,
				saw: seen.join("; "),
			};

		const paths: [string, () => Promise<string | null>][] =
			row.run.isolation === "clean"
				? [
						[
							"clean session and turn",
							() => isolatedSession(harness, env, workspace, "clean", true),
						],
					]
				: [
						[
							"isolated session",
							() => isolatedSession(harness, env, workspace, "probe", false),
						],
						[
							"background pass",
							async () => {
								try {
									await probeHarness(harness, {
										requireIsolation: true,
										mcp: FOUND_MCP,
										seedWorkspace: seed,
										sandbox: async () => ({}),
									});
									return null;
								} catch (err) {
									return err instanceof CheckNotIsolatedError
										? `no safe check: ${err.message}`
										: String(err);
								}
							},
						],
						[
							"Check",
							async () => {
								await probeHarness(harness, {
									mcp: FOUND_MCP,
									seedWorkspace: seed,
									sandbox: async () => ({}),
								});
								return null;
							},
						],
						[
							"title",
							async () => {
								await nameThread(harness, {
									prompt: "Name this thread.",
									mcp: FOUND_MCP,
									seedWorkspace: seed,
									timeoutMs: 60_000,
								}).catch(() => undefined);
								return null;
							},
						],
						[
							"limit read",
							async () => {
								await readAgentLimits(harness).catch(() => null);
								return null;
							},
						],
					];
		for (const [name, run] of paths) {
			const refused = await run();
			await settle(1_000);
			const left = take(markers);
			seen.push(`${name}: ${refused ?? (left.join(",") || "none")}`);
			if (refused)
				return { problem: `${name}: ${refused}`, saw: seen.join("; ") };
			if (left.length)
				return {
					problem: `${name} fired ${left.join(",")}`,
					saw: seen.join("; "),
				};
		}
		return { problem: null, saw: seen.join("; ") };
	} finally {
		if (key) {
			for (const [k, v] of Object.entries(before))
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			const home = env[key];
			if (home && home !== given[key])
				rmSync(dirname(home), { recursive: true, force: true, maxRetries: 5 });
		}
		if (existsSync(markers)) rmSync(markers, { recursive: true, force: true });
	}
}
