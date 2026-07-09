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
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	await rm(dir, { recursive: true, force: true });
});

const REPORT = { summary: "fake report" } as unknown as InvestigationReport;

function firingAlert(alertname = "HighCPU"): Record<string, unknown> {
	return {
		status: "firing",
		labels: { alertname },
		startsAt: "2026-07-09T03:00:00Z",
	};
}

async function writeConfig(baseDir: string): Promise<void> {
	await writeFile(
		join(dir, "prismalens.config.yaml"),
		`workspace:\n  base_dir: ${baseDir}\n`,
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

		await run(firingAlert());

		const runIds = await readdir(join(workspace, "runs"));
		expect(runIds).toHaveLength(1);
		const report = JSON.parse(
			await readFile(
				join(workspace, "runs", runIds[0] as string, "report.json"),
				"utf-8",
			),
		) as InvestigationReport;
		expect(report).toEqual(REPORT);
	});

	it("re-resolves config from disk per alert, not once at startup", async () => {
		const first = join(dir, "workspace-a");
		const second = join(dir, "workspace-b");
		const run = createInvestigationRunner(
			{ cwd: dir, log: () => {} },
			{ conductRun: fakeConductRun(), resolveRunSandbox: noSandbox },
		);

		await writeConfig(first);
		await run(firingAlert("First"));
		await writeConfig(second);
		await run(firingAlert("Second"));

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

		await run({
			status: "firing",
			labels: { alertname: "HighCPU", service: "checkout" },
			startsAt: "2026-07-09T03:00:00Z",
		});

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
		await expect(run(firingAlert())).rejects.toThrow(/no evidence/);
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
		await expect(run(firingAlert())).rejects.toThrow(/produced no evidence/);
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
			await run(firingAlert());
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

		await expect(run(firingAlert())).rejects.toThrow("harness exploded");
		expect(destroy).toHaveBeenCalledTimes(1);
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
			const res = await fetch(
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
			expect(res.status).toBe(202);
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
			`workspace:\n  base_dir: ${workspace}\nlisten:\n  port: 0\n  token: e2e-token\n`,
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
			await fetch(`http://127.0.0.1:${server.port}/webhooks/alertmanager`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: "Bearer e2e-token",
				},
				body: JSON.stringify({ status: "firing", alerts: [firingAlert()] }),
			});
			await vi.waitFor(() => {
				expect(lines.join("\n")).toContain("harness exploded");
			});
		} finally {
			await server.close();
		}
	});

	it("labels a label-less alert 'unknown alert' and stringifies a non-Error failure", async () => {
		const workspace = join(dir, "workspace");
		await writeFile(
			join(dir, "prismalens.config.yaml"),
			`workspace:\n  base_dir: ${workspace}\nlisten:\n  port: 0\n  token: e2e-token\n`,
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
			await fetch(`http://127.0.0.1:${server.port}/webhooks/alertmanager`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: "Bearer e2e-token",
				},
				body: JSON.stringify({
					status: "firing",
					alerts: [
						// labels present but empty: no alertname to report.
						{ status: "firing", labels: {}, startsAt: "2026-07-09T03:00:00Z" },
					],
				}),
			});
			await vi.waitFor(() => {
				const all = lines.join("\n");
				expect(all).toContain("unknown alert");
				expect(all).toContain("plain string failure");
			});
		} finally {
			await server.close();
		}
	});
});

describe("resolveRepoPath (alert label → repo checkout, AC5)", () => {
	const fallback = "/listen-cwd";
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
		expect(
			resolveRepoPath(alertFor({ service: "checkout" }), config, fallback),
		).toBe("/src/checkout");
	});

	it("uses services[].repo directly when it is an existing local path", () => {
		const config = PlConfigSchema.parse({
			services: { checkout: { repo: dir } },
		});
		expect(
			resolveRepoPath(alertFor({ service: "checkout" }), config, fallback),
		).toBe(dir);
	});

	it("falls back to the listen cwd when the alert carries no known service", () => {
		const config = PlConfigSchema.parse({});
		expect(resolveRepoPath(alertFor({}), config, fallback)).toBe(fallback);
		expect(
			resolveRepoPath(
				alertFor({ service: "not-in-catalog" }),
				config,
				fallback,
			),
		).toBe(fallback);
	});

	it("falls back when the mapped repo is a slug with no local_path or checkout", () => {
		const config = PlConfigSchema.parse({
			services: { checkout: { repo: "acme/checkout" } },
			repos: { "acme/checkout": { repo: "acme/checkout" } },
		});
		expect(
			resolveRepoPath(alertFor({ service: "checkout" }), config, fallback),
		).toBe(fallback);
	});
});
