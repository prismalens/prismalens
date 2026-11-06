// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import { type PermissionPolicy, runInvestigation } from "@prismalens/engine";
import { afterAll, describe, expect, it } from "vitest";
import { installFakeAgent } from "../../../../scripts/fakes/fake-acp-agent.mjs";

const root = mkdtempSync(join(tmpdir(), "pl-subagents-"));
const binDir = mkdtempSync(join(root, "bin-"));
installFakeAgent(binDir, { session: "success" });
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Subagent = Extract<CanonicalEvent, { kind: "subagent" }>;

/** Approves every ask and records which session asked. */
const approveAll =
	(asked: (string | undefined)[]): PermissionPolicy =>
	async (req) => {
		asked.push(req.sessionId);
		const allow = req.options.find((o) => o.kind === "allow_once");
		return { allow: true, optionId: allow?.optionId ?? "allow", outcome: "approved" };
	};

/** Runs `session` through the real engine; `onEvent` may cancel a sub-agent as its events stream. */
async function run(
	session: string,
	opts: {
		permission?: PermissionPolicy;
		onEvent?: (ev: CanonicalEvent, cancel: (id: string) => boolean) => void;
	} = {},
): Promise<CanonicalEvent[]> {
	const events: CanonicalEvent[] = [];
	let cancel: (id: string) => boolean = () => false;
	for await (const ev of runInvestigation({
		runId: "22222222-2222-4222-8222-222222222222",
		context: {
			alerts: [
				{
					alertname: `BooksSlow fake-session:${session}`,
					severity: "critical",
					labels: {},
					annotations: {},
					startsAt: null,
				},
			],
			service: { name: "books" },
		},
		harness: "claude-code",
		descriptor: {
			...HARNESS_REGISTRY["claude-code"],
			binary: join(
				binDir,
				process.platform === "win32" ? "claude-agent-acp.cmd" : "claude-agent-acp",
			),
		},
		cwd: mkdtempSync(join(root, "clone-")),
		runDir: mkdtempSync(join(root, "run-")),
		initTimeoutMs: 10_000,
		promptTimeoutMs: 20_000,
		...(opts.permission ? { permission: opts.permission } : {}),
		subagents: {
			onCancel: (handler) => {
				cancel = handler;
				return () => {
					cancel = () => false;
				};
			},
		},
	})) {
		events.push(ev);
		opts.onEvent?.(ev, cancel);
	}
	return events;
}

const subagents = (events: CanonicalEvent[]) =>
	events.filter((e): e is Subagent => e.kind === "subagent");

describe("Walk: an agent starts sub-agents in its session, and the thread shows each (#1025)", () => {
	it("Given two sub-agents, When one asks and is stopped and the other may not be, Then each streams its own steps, its ask names it, and only the granted cancel reaches the agent", async () => {
		const asked: (string | undefined)[] = [];
		const cancels: Record<string, boolean> = {};
		const events = await run("subagents", {
			permission: approveAll(asked),
			onEvent: (ev, cancel) => {
				if (ev.kind !== "subagent") return;
				// The refused one is tried as soon as it starts; the granted one once it waits.
				if (ev.sessionId === "sub-metrics" && ev.phase === "started")
					cancels["sub-metrics"] = cancel("sub-metrics");
				if (ev.sessionId === "sub-deploys" && ev.phase === "step" && ev.step?.includes("Write"))
					setTimeout(() => {
						cancels["sub-deploys"] = cancel("sub-deploys");
					}, 300);
			},
		});

		const started = subagents(events).filter((e) => e.phase === "started");
		expect(started).toEqual([
			expect.objectContaining({
				sessionId: "sub-deploys",
				title: "Check deploys",
				task: "Read the last deploys of the books service",
				state: "running",
				canCancel: true,
				path: [],
			}),
			expect.objectContaining({ sessionId: "sub-metrics", canCancel: false }),
		]);
		expect(cancels).toEqual({ "sub-metrics": false, "sub-deploys": true });
		const ended = Object.fromEntries(
			subagents(events)
				.filter((e) => e.phase === "state" && e.state)
				.map((e) => [e.sessionId, e.state]),
		);
		expect(ended).toEqual({ "sub-deploys": "cancelled", "sub-metrics": "completed" });

		// Each sub-agent's steps carry its session as the path and its title as the label.
		const deploySteps = events.filter(
			(e) => "path" in e && e.path[0] === "sub-deploys" && e.kind !== "subagent",
		);
		expect(deploySteps.map((e) => e.kind)).toContain("tool_result");
		expect(deploySteps.every((e) => "label" in e && e.label === "Check deploys")).toBe(true);
		const words = deploySteps
			.flatMap((e) => (e.kind === "agent_step" ? [e.text] : []))
			.join("");
		expect(words).toContain("Revision 41 shipped d37d888");

		// The ask came from the sub-agent's session and says so.
		expect(asked).toEqual(["sub-deploys"]);
		const ask = events.find((e) => e.kind === "permission_ask");
		expect(ask).toMatchObject({
			source: { kind: "subagent", sessionId: "sub-deploys", title: "Check deploys" },
		});

		// The main agent's text, and so its report, holds none of the sub-agents' words.
		const top = events
			.flatMap((e) => (e.kind === "agent_step" && e.path.length === 0 ? [e.text] : []))
			.join("");
		expect(top).toContain("Both helpers are back");
		expect(top).not.toContain("Reading the deploy log");
		expect(events.at(-1)?.kind).toBe("report");
	}, 60_000);

	it("Given an agent that sends no sub-agent sessions, When its helper's steps carry parentToolUseId, Then they nest under that call and an unknown parent stays at the top", async () => {
		const events = await run("subagents-flat");
		expect(subagents(events)).toEqual([]);
		const nested = events.filter((e) => "path" in e && e.path[0] === "toolu_task");
		expect(nested.map((e) => e.kind)).toEqual(
			expect.arrayContaining(["agent_step", "tool_result"]),
		);
		expect(nested.every((e) => "label" in e && e.label === "Task: check deploys")).toBe(true);
		const orphan = events.find(
			(e) => e.kind === "tool_result" && e.result.toolCallId === "toolu_orphan",
		);
		expect(orphan).toMatchObject({ path: [], label: null });
		const top = events
			.flatMap((e) => (e.kind === "agent_step" && e.path.length === 0 ? [e.text] : []))
			.join("");
		expect(top).not.toContain("Reading the deploy log");
		expect(events.at(-1)?.kind).toBe("report");
	}, 60_000);
});
