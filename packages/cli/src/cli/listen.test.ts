// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl listen` investigation runner (issue #58) — the per-alert seam chain
 * (loadConfig → resolveRunSandbox → resolveInvestigation → conductRun + file
 * store), cloned from the jsonrpc `handleInvestigate` path. Real config loader,
 * real resolver, real file session store in a temp workspace; ONLY the two
 * external boundaries are faked: `conductRun` (spawns a harness) and
 * `resolveRunSandbox` (probes/spawns a sandbox).
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { InvestigationReport } from "@prismalens/contracts";
import type { conductRun, SandboxSelection } from "@prismalens/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlConfigSchema } from "../config/schema.js";
import type { resolveRunSandbox } from "./investigate.js";
import {
	createInvestigationRunner,
	resolveRepoPath,
	startListenFromConfig,
} from "./listen.js";

type ConductRun = typeof conductRun;
type ResolveRunSandbox = typeof resolveRunSandbox;

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "pl-listen-runner-"));
});
afterEach(async () => {
	// maxRetries: the sqlite store leaves WAL sidecar files whose handles unmap
	// asynchronously; on WSL2 that races a plain recursive rmdir (ENOTEMPTY).
	await rm(dir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50,
	});
});

const REPORT = { summary: "fake report" } as unknown as InvestigationReport;

function firingAlert(
	alertname = "HighCPU",
	fingerprint?: string,
): Record<string, unknown> {
	return {
		status: "firing",
		labels: { alertname, service: "checkout" },
		startsAt: "2026-07-09T03:00:00Z",
		...(fingerprint ? { fingerprint } : {}),
	};
}

async function writeConfig(baseDir: string): Promise<void> {
	await writeFile(
		join(dir, "prismalens.config.yaml"),
		`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${baseDir}\n`,
		"utf-8",
	);
}

/** A contract-faithful conductRun fake: creates, streams one event, reports. */
function fakeConductRun(): ConductRun {
	return (async (inputs, io) => {
		await io.store.create();
		io.sink({
			kind: "agent_step",
			text: "probing the service",
			toolCalls: [],
		} as unknown as Parameters<typeof io.sink>[0]);
		await io.store.finish(REPORT);
		return { runId: inputs.runId, report: REPORT };
	}) as ConductRun;
}

const noSandbox: ResolveRunSandbox = async () => ({
	selection: null,
	degradeReason: null,
	degradeExpected: false,
});

describe("createInvestigationRunner (per-alert seam chain)", () => {
	it("runs a valid alert through the chain and the report lands in the run workspace", async () => {
		const workspace = join(dir, "workspace");
		await writeConfig(workspace);
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{ conductRun: fakeConductRun(), resolveRunSandbox: noSandbox },
		);

		await run("run-123", [firingAlert()]);

		const runIds = await readdir(join(workspace, "runs"));
		expect(runIds).toHaveLength(1);
		const { createSessionManager } = await import("../core/session.js");
		const sessions = createSessionManager(workspace);
		const report = await sessions.readReport(runIds[0] as string);
		sessions.close?.();
		expect(report).toEqual(REPORT);
	});

	it("respects max_concurrent cap and records suppression", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  caps:\n    max_concurrent: 1\n`,
			"utf-8",
		);

		let release = (): void => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});

		const conductSpy = vi.fn(async (inputs) => {
			await gate;
			return { runId: inputs.runId, report: REPORT };
		});

		const { createCapsGate } = await import("../core/caps.js");
		const gateInst = createCapsGate();

		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{
				conductRun: conductSpy as unknown as ConductRun,
				resolveRunSandbox: noSandbox,
				capsGate: gateInst,
			},
		);

		const p1 = run("run-cap-1", [firingAlert()]);
		// Wait until the first run is fully in-flight — its caps slot acquired AND
		// blocked inside conductRun on the gate — before dispatching the second.
		// A fixed sleep raced on slow CI: p1 could still be between tryDispatch and
		// conductRun, so the cap looked free / conductSpy showed 0 calls.
		await vi.waitFor(() => expect(conductSpy).toHaveBeenCalledTimes(1));

		await run("run-cap-2", [firingAlert()]);

		expect(conductSpy).toHaveBeenCalledTimes(1);

		const { createSessionManager } = await import("../core/session.js");
		const sessions = createSessionManager(workspace);
		const suppressed = await sessions.get("run-cap-2");
		expect(suppressed?.status).toBe("suppressed");
		expect(suppressed?.suppressionReason).toBe("concurrency");

		sessions.close?.();

		release();
		await p1;
	});

	it("suppression that throws does not crash the running investigation", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  caps:\n    max_concurrent: 1\n`,
			"utf-8",
		);

		let release = (): void => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});

		const conductSpy = vi.fn(async (inputs) => {
			await gate;
			return { runId: inputs.runId, report: REPORT };
		});

		const { createCapsGate } = await import("../core/caps.js");
		const gateInst = createCapsGate();

		const { SqliteSessionManager } = await import(
			"../core/sqlite-session-store.js"
		);
		const spy = vi
			.spyOn(SqliteSessionManager.prototype, "recordSuppressed")
			.mockRejectedValue(new Error("db down"));

		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{
				conductRun: conductSpy as unknown as ConductRun,
				resolveRunSandbox: noSandbox,
				capsGate: gateInst,
			},
		);

		const p1 = run("run-cap-3", [firingAlert()]);
		// Wait until the first run is fully in-flight — its caps slot acquired AND
		// blocked inside conductRun on the gate — before dispatching the second.
		// A fixed sleep raced on slow CI: p1 could still be between tryDispatch and
		// conductRun, so the cap looked free / conductSpy showed 0 calls.
		await vi.waitFor(() => expect(conductSpy).toHaveBeenCalledTimes(1));

		await expect(run("run-cap-4", [firingAlert()])).rejects.toThrow("db down");

		expect(conductSpy).toHaveBeenCalledTimes(1);
		expect(gateInst.activeCount).toBe(1);

		release();
		await p1;

		expect(gateInst.activeCount).toBe(0);
		spy.mockRestore();
	});

	it("re-resolves config from disk per alert, not once at startup", async () => {
		const first = join(dir, "workspace-a");
		const second = join(dir, "workspace-b");
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{ conductRun: fakeConductRun(), resolveRunSandbox: noSandbox },
		);

		await writeConfig(first);
		await run("run-1", [firingAlert("First")]);
		await writeConfig(second);
		await run("run-2", [firingAlert("Second")]);

		expect(await readdir(join(first, "runs"))).toHaveLength(1);
		expect(await readdir(join(second, "runs"))).toHaveLength(1);
	});

	it("investigates the repo the alert's service label maps to, not the listen cwd", async () => {
		const checkout = join(dir, "checkout-repo");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			[
				`workspace:`,
				`  base_dir: ${join(dir, "workspace")}`,
				`services:`,
				`  checkout:`,
				`    repo: acme/checkout`,
				`repos:`,
				`  acme/checkout:`,
				`    repo: acme/checkout`,
				`    local_path: ${checkout}`,
				``,
			].join("\n"),
			"utf-8",
		);
		const lines: string[] = [];
		const run = createInvestigationRunner(
			{ cwd: dir, log: (l) => lines.push(l) },
			{ conductRun: fakeConductRun(), resolveRunSandbox: noSandbox },
		);

		await run("run-3", [
			{
				status: "firing",
				labels: { alertname: "HighCPU", service: "checkout" },
				startsAt: "2026-07-09T03:00:00Z",
			},
		]);

		expect(lines.join("\n")).toContain(`in ${checkout} `);
	});

	it("rejects (for the server's error log) when the run produces no report", async () => {
		await writeConfig(join(dir, "workspace"));
		const noEvidence: ConductRun = (async (inputs) => ({
			runId: inputs.runId,
			report: null,
			error: "no evidence gathered",
		})) as unknown as ConductRun;
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{ conductRun: noEvidence, resolveRunSandbox: noSandbox },
		);
		await expect(run("run-4", [firingAlert()])).rejects.toThrow(/no evidence/);
	});

	it("falls back to a generic reason when a no-report outcome carries no error", async () => {
		await writeConfig(join(dir, "workspace"));
		const silent: ConductRun = (async (inputs) => ({
			runId: inputs.runId,
			report: null,
		})) as unknown as ConductRun;
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{ conductRun: silent, resolveRunSandbox: noSandbox },
		);
		await expect(run("run-5", [firingAlert()])).rejects.toThrow(
			/produced no evidence/,
		);
	});

	it("constructs with the real engine boundaries when no deps are injected", () => {
		const run = createInvestigationRunner({ cwd: dir, log: () => {} });
		expect(typeof run).toBe("function");
	});

	it("defaults to process.cwd() when no cwd is given", async () => {
		const prev = process.cwd();
		process.chdir(dir);
		try {
			await writeConfig(join(dir, "workspace"));
			const run = createInvestigationRunner(
				{ log: () => {} },
				{ conductRun: fakeConductRun(), resolveRunSandbox: noSandbox },
			);
			await run("run-6", [firingAlert()]);
			expect(await readdir(join(dir, "workspace", "runs"))).toHaveLength(1);
		} finally {
			process.chdir(prev);
		}
	});

	it("destroys the sandbox in finally even when conductRun throws", async () => {
		await writeConfig(join(dir, "workspace"));
		const destroy = vi.fn(async () => {});
		const withSandbox: ResolveRunSandbox = async () => ({
			selection: {
				sandbox: { destroy },
				requested: "auto",
				actual: "process",
			} as unknown as SandboxSelection,
			degradeReason: null,
			degradeExpected: true,
		});
		const boom: ConductRun = (async () => {
			throw new Error("harness exploded");
		}) as ConductRun;
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{ conductRun: boom, resolveRunSandbox: withSandbox },
		);

		await expect(run("run-7", [firingAlert()])).rejects.toThrow(
			"harness exploded",
		);
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it("notifies Slack exactly once per group investigation when configured", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  slack_webhook_url: http://slack.test\n`,
			"utf-8",
		);
		const notifySpy = vi.fn().mockResolvedValue(undefined);
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{
				conductRun: fakeConductRun(),
				resolveRunSandbox: noSandbox,
				notify: notifySpy,
			},
		);

		await run("run-slack-1", [
			firingAlert("GroupAlert1"),
			firingAlert("GroupAlert2"),
		]);

		expect(notifySpy).toHaveBeenCalledTimes(1);
		expect(notifySpy).toHaveBeenCalledWith(
			"http://slack.test",
			"GroupAlert1",
			expect.objectContaining({ runId: "run-slack-1" }),
		);
	});

	it("never notifies Slack if slack_webhook_url is omitted", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\n`,
			"utf-8",
		);
		const notifySpy = vi.fn().mockResolvedValue(undefined);
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{
				conductRun: fakeConductRun(),
				resolveRunSandbox: noSandbox,
				notify: notifySpy,
			},
		);

		await run("run-slack-2", [firingAlert("DisabledAlert")]);

		expect(notifySpy).not.toHaveBeenCalled();
	});

	it("isolates the run from a broken Slack webhook (run-outcome isolation)", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  slack_webhook_url: http://slack.test\n`,
			"utf-8",
		);
		const notifySpy = vi.fn().mockRejectedValue(new Error("slack is down"));
		const lines: string[] = [];
		const run = createInvestigationRunner(
			{ cwd: dir, log: (l) => lines.push(l) },
			{
				conductRun: fakeConductRun(),
				resolveRunSandbox: noSandbox,
				notify: notifySpy,
			},
		);

		await run("run-slack-3", [firingAlert("BrokenSlack")]);

		expect(notifySpy).toHaveBeenCalledTimes(1);
		expect(lines.join("\n")).toContain("Report saved for run run-slack-3");
	});

	it("notifies Slack for a no-evidence outcome", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  slack_webhook_url: http://slack.test\n`,
			"utf-8",
		);
		const noEvidence: ConductRun = (async (inputs) => ({
			runId: inputs.runId,
			report: null,
			failureKind: "no-evidence",
			error: "no evidence gathered",
		})) as unknown as ConductRun;
		const notifySpy = vi.fn().mockResolvedValue(undefined);
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{
				conductRun: noEvidence,
				resolveRunSandbox: noSandbox,
				notify: notifySpy,
			},
		);

		// A no-report outcome still rejects (the server logs it), but notify
		// fires first — gating is on webhook presence, not on the outcome.
		await expect(
			run("run-slack-4", [firingAlert("NoEvidenceAlert")]),
		).rejects.toThrow(/no evidence/);

		expect(notifySpy).toHaveBeenCalledTimes(1);
		expect(notifySpy).toHaveBeenCalledWith(
			"http://slack.test",
			"NoEvidenceAlert",
			expect.objectContaining({
				runId: "run-slack-4",
				failureKind: "no-evidence",
			}),
		);
	});

	it("notifies Slack for an errored outcome", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  slack_webhook_url: http://slack.test\n`,
			"utf-8",
		);
		const errored: ConductRun = (async (inputs) => ({
			runId: inputs.runId,
			report: null,
			failureKind: "error",
			error: "harness crashed",
		})) as unknown as ConductRun;
		const notifySpy = vi.fn().mockResolvedValue(undefined);
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{
				conductRun: errored,
				resolveRunSandbox: noSandbox,
				notify: notifySpy,
			},
		);

		await expect(
			run("run-slack-5", [firingAlert("ErroredAlert")]),
		).rejects.toThrow(/harness crashed/);

		expect(notifySpy).toHaveBeenCalledTimes(1);
		expect(notifySpy).toHaveBeenCalledWith(
			"http://slack.test",
			"ErroredAlert",
			expect.objectContaining({ runId: "run-slack-5", failureKind: "error" }),
		);
	});

	it("still invokes notify for a cancelled outcome (seam gates on webhook, not outcome; the empty-message suppression lives inside notifyRun)", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  slack_webhook_url: http://slack.test\n`,
			"utf-8",
		);
		const cancelled: ConductRun = (async (inputs) => ({
			runId: inputs.runId,
			report: null,
			failureKind: "cancelled",
			error: "user abort",
		})) as unknown as ConductRun;
		const notifySpy = vi.fn().mockResolvedValue(undefined);
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{
				conductRun: cancelled,
				resolveRunSandbox: noSandbox,
				notify: notifySpy,
			},
		);

		await expect(
			run("run-slack-6", [firingAlert("CancelledAlert")]),
		).rejects.toThrow(/user abort/);

		// The listen seam does NOT skip cancelled — it hands the outcome to
		// notify; the real notifyRun then builds an empty message and posts
		// nothing (verified in slack-notify.test.ts).
		expect(notifySpy).toHaveBeenCalledTimes(1);
		expect(notifySpy).toHaveBeenCalledWith(
			"http://slack.test",
			"CancelledAlert",
			expect.objectContaining({
				runId: "run-slack-6",
				failureKind: "cancelled",
			}),
		);
	});
});

describe("startListenFromConfig (the pl listen command body)", () => {
	it("refuses to start when listen.token is not configured", async () => {
		await writeConfig(join(dir, "workspace"));
		await expect(
			startListenFromConfig({ cwd: dir, log: () => {} }),
		).rejects.toThrow(/listen\.token/);
	});

	it("serves a webhook end-to-end: valid alert in → report in the workspace", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			[
				`services:`,
				`  checkout:`,
				`    repo: ${dir}`,
				`workspace:`,
				`  base_dir: ${workspace}`,
				`listen:`,
				`  port: 0`, // ephemeral — the OS picks a free port
				`  token: e2e-token`,
				``,
			].join("\n"),
			"utf-8",
		);
		const lines: string[] = [];
		const server = await startListenFromConfig(
			{ cwd: dir, log: (l) => lines.push(l) },
			{ conductRun: fakeConductRun(), resolveRunSandbox: noSandbox },
		);
		try {
			vi.useFakeTimers();
			const fetchPromise = fetch(
				`http://127.0.0.1:${server.port}/webhooks/alertmanager`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: "Bearer e2e-token",
					},
					body: JSON.stringify({
						status: "firing",
						alerts: [firingAlert()],
					}),
				},
			);
			await vi.advanceTimersByTimeAsync(100); // allow fetch to be handled
			const res = await fetchPromise;
			expect(res.status).toBe(202);
			await vi.runAllTimersAsync();
			vi.useRealTimers();
			await vi.waitFor(async () => {
				expect(await readdir(join(workspace, "runs"))).toHaveLength(1);
			});
		} finally {
			await server.close();
		}
	});

	it("logs a failed run through the injected log, never silently", async () => {
		const workspace = join(dir, "workspace");
		const configPath = join(dir, "prismalens.config.yaml");
		await writeFile(
			configPath,
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  port: 0\n  token: e2e-token\n`,
			"utf-8",
		);
		const lines: string[] = [];
		const boom: ConductRun = (async () => {
			throw new Error("harness exploded");
		}) as ConductRun;
		const server = await startListenFromConfig(
			// configPath exercises the explicit-config route the --config flag takes.
			{ cwd: dir, configPath, log: (l) => lines.push(l) },
			{ conductRun: boom, resolveRunSandbox: noSandbox },
		);
		try {
			vi.useFakeTimers();
			const fetchPromise = fetch(
				`http://127.0.0.1:${server.port}/webhooks/alertmanager`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: "Bearer e2e-token",
					},
					body: JSON.stringify({ status: "firing", alerts: [firingAlert()] }),
				},
			);
			await vi.advanceTimersByTimeAsync(100);
			await fetchPromise;
			await vi.runAllTimersAsync();
			vi.useRealTimers();
			await vi.waitFor(() => {
				expect(lines.join("\n")).toContain("harness exploded");
			});
		} finally {
			await server.close();
		}
	});

	it("stringifies a non-Error failure from the harness", async () => {
		vi.useFakeTimers();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await writeFile(
				join(dir, "prismalens.config.yaml"),
				`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${join(dir, "ws")}\nlisten:\n  port: 0\n  token: e2e-token\n`,
				"utf-8",
			);
			const lines: string[] = [];
			const boomString: ConductRun = (async () => {
				// A rejection that is not an Error instance (e.g. a re-thrown string).
				throw "plain string failure";
			}) as unknown as ConductRun;
			const server = await startListenFromConfig(
				{ cwd: dir, log: (l) => lines.push(l) },
				{ conductRun: boomString, resolveRunSandbox: noSandbox },
			);
			try {
				vi.useFakeTimers();
				const fetchPromise = fetch(
					`http://127.0.0.1:${server.port}/webhooks/alertmanager`,
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: "Bearer e2e-token",
						},
						body: JSON.stringify({
							status: "firing",
							alerts: [
								// labels present to pass AC5 check
								{
									status: "firing",
									labels: { alertname: "TestAlert", service: "checkout" },
									startsAt: "2026-07-09T03:00:00Z",
								},
							],
						}),
					},
				);
				await vi.advanceTimersByTimeAsync(100);
				await fetchPromise;
				await vi.runAllTimersAsync();
				vi.useRealTimers();
				await vi.waitFor(() => {
					const all = lines.join("\n");
					expect(all).toContain("group TestAlert\0checkout failed");
					expect(all).toContain("plain string failure");
				});
			} finally {
				await server.close();
			}
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("handles late alerts safely while investigation runs (grouping disk race fix)", async () => {
		vi.useFakeTimers();
		try {
			const workspace = join(dir, "workspace");
			await writeFile(
				join(dir, "prismalens.config.yaml"),
				`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  port: 0\n  token: e2e-token\n  grouping_window_ms: 1000\n`,
				"utf-8",
			);
			const lines: string[] = [];

			let release = (): void => {};
			const gate = new Promise<void>((r) => {
				release = r;
			});
			const waitAndSucceed: ConductRun = (async (inputs) => {
				await gate;
				return { runId: inputs.runId, report: REPORT };
			}) as unknown as ConductRun;

			const server = await startListenFromConfig(
				{ cwd: dir, log: (l) => lines.push(l) },
				{ conductRun: waitAndSucceed, resolveRunSandbox: noSandbox },
			);

			try {
				// 1) POST first alert, opens window
				const fetch1 = fetch(
					`http://127.0.0.1:${server.port}/webhooks/alertmanager`,
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: "Bearer e2e-token",
						},
						body: JSON.stringify({
							status: "firing",
							alerts: [firingAlert("RaceFix", "first-fp")],
						}),
					},
				);
				await vi.advanceTimersByTimeAsync(100);
				await fetch1;

				// 2) Advance time past window to trigger write + investigation (which blocks on gate)
				await vi.advanceTimersByTimeAsync(1000);

				// 3) POST second alert for same group while investigation is in-flight
				const fetch2 = fetch(
					`http://127.0.0.1:${server.port}/webhooks/alertmanager`,
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: "Bearer e2e-token",
						},
						body: JSON.stringify({
							status: "firing",
							alerts: [firingAlert("RaceFix", "second-fp")],
						}),
					},
				);
				await vi.advanceTimersByTimeAsync(100);
				await fetch2;

				// 4) Release gate, finish
				release();
				await vi.runAllTimersAsync();
				vi.useRealTimers();

				// 5) Verify the group record (sqlite) captured both alerts. The fake
				// conductRun never calls store.create(), so there is no run dir — the
				// group lives purely in the db, keyed by the grouping layer's runId.
				await vi.waitFor(async () => {
					const { DatabaseSync } = await import("node:sqlite");
					const db = new DatabaseSync(join(workspace, "prismalens.db"));
					try {
						const group = db
							.prepare("SELECT id, formed_by FROM groups")
							.get() as { id: string; formed_by: string } | undefined;
						expect(group?.formed_by).toBe("window");
						const rows = db
							.prepare(
								"SELECT payload, late FROM group_alerts WHERE group_id = ? ORDER BY id",
							)
							.all(group?.id) as { payload: string; late: number }[];
						const alerts = rows
							.filter((r) => r.late === 0)
							.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
						const lateAlerts = rows
							.filter((r) => r.late === 1)
							.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
						expect(alerts).toHaveLength(1);
						expect(alerts[0].fingerprint).toBe("first-fp");
						expect(lateAlerts).toHaveLength(1);
						expect(lateAlerts[0].fingerprint).toBe("second-fp");
					} finally {
						db.close();
					}
				});
			} finally {
				await server.close();
			}
		} finally {
			vi.useRealTimers();
		}
	});

	it("prints one raw-passthrough startup line when no Tier-1 provider is configured", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  port: 0\n  token: e2e-token\n`,
			"utf-8",
		);

		const oldEnv = { ...process.env };
		delete process.env.OLLAMA_API_KEY;
		delete process.env.OPENAI_API_KEY;
		delete process.env.OLLAMA_BASE_URL;
		delete process.env.OPENAI_BASE_URL;

		try {
			const lines: string[] = [];
			const server = await startListenFromConfig(
				{ cwd: dir, log: (l) => lines.push(l) },
				{ resolveRunSandbox: noSandbox },
			);
			await server.close();

			const matching = lines.filter((l) =>
				l.includes("RAW harness pass-through"),
			);
			expect(matching).toHaveLength(1);
		} finally {
			process.env = oldEnv;
		}
	});

	it("omits the startup line when a provider key is set", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`services:\n  checkout:\n    repo: ${dir}\nworkspace:\n  base_dir: ${workspace}\nlisten:\n  port: 0\n  token: e2e-token\n`,
			"utf-8",
		);

		const oldEnv = { ...process.env };
		process.env.OPENAI_API_KEY = "k";

		try {
			const lines: string[] = [];
			const server = await startListenFromConfig(
				{ cwd: dir, log: (l) => lines.push(l) },
				{ resolveRunSandbox: noSandbox },
			);
			await server.close();

			const matching = lines.filter((l) =>
				l.includes("RAW harness pass-through"),
			);
			expect(matching).toHaveLength(0);
		} finally {
			process.env = oldEnv;
		}
	});
});

describe("resolveRepoPath (alert label → repo checkout, AC5)", () => {
	const alertFor = (
		labels: Record<string, string>,
	): Record<string, unknown> => ({
		status: "firing",
		labels: { alertname: "HighCPU", ...labels },
		startsAt: "2026-07-09T03:00:00Z",
	});

	it("maps service label → services[].repo (slug) → repos[].local_path", () => {
		const config = PlConfigSchema.parse({
			services: { checkout: { repo: "acme/checkout" } },
			repos: {
				"acme/checkout": { repo: "acme/checkout", local_path: "/src/checkout" },
			},
		});
		expect(resolveRepoPath(alertFor({ service: "checkout" }), config)).toBe(
			resolve("/src/checkout"),
		);
	});

	it("uses services[].repo directly when it is an existing local path", () => {
		const config = PlConfigSchema.parse({
			services: { checkout: { repo: dir } },
		});
		expect(resolveRepoPath(alertFor({ service: "checkout" }), config)).toBe(
			resolve(dir),
		);
	});

	it("throws when the alert carries no known service", () => {
		const config = PlConfigSchema.parse({});
		expect(() => resolveRepoPath(alertFor({}), config)).toThrow(
			"Listen dispatch refused: alert is missing a service label",
		);
		expect(() =>
			resolveRepoPath(alertFor({ service: "not-in-catalog" }), config),
		).toThrow(
			'Listen dispatch refused: service "not-in-catalog" has no mapped repo in config',
		);
	});

	it("throws when the mapped repo is a slug with no local_path or checkout", () => {
		const config = PlConfigSchema.parse({
			services: { checkout: { repo: "acme/checkout" } },
			repos: { "acme/checkout": { repo: "acme/checkout" } },
		});
		expect(() =>
			resolveRepoPath(alertFor({ service: "checkout" }), config),
		).toThrow(
			'Listen dispatch refused: repo "acme/checkout" (mapped from service "checkout") does not exist locally',
		);
	});
});
