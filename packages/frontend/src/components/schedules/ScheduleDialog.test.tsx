// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Schedule } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleDialog } from "./ScheduleDialog";

type Agent = { id: string; label: string };
let agents: { harnesses: Agent[]; effective: Agent | undefined; model: string };
const create = vi.fn();

vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => agents,
	ModelChip: ({ harness, model }: { harness?: Agent; model: string }) => (
		<span data-testid="chip">{`${harness?.id ?? "none"}:${model}`}</span>
	),
}));
vi.mock("@/lib/api/hooks", () => ({
	useServices: () => ({
		data: {
			data: [{ id: "11111111-1111-4111-8111-111111111111", name: "checkout" }],
		},
	}),
}));
vi.mock("@/lib/api/hooks/use-schedules-orpc", () => ({
	useCreateSchedule: () => ({ mutateAsync: create, isPending: false }),
	useUpdateSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useSchedulePreview: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const claude: Agent = { id: "claude-code", label: "Claude Code" };
const source = {
	id: "s1",
	name: "Morning check",
	serviceId: "11111111-1111-4111-8111-111111111111",
	serviceName: "checkout",
	runbook: null,
	brief: "Look at the pool",
	recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
	harness: "claude-code",
	model: "opus",
	effort: "high",
	missedPolicy: "skip",
	catchUpMinutes: 90,
} as unknown as Schedule;

let root: Root;
const render = (props: Partial<Parameters<typeof ScheduleDialog>[0]> = {}) =>
	act(async () =>
		root.render(
			<ScheduleDialog open onOpenChange={() => {}} canSetHostZone {...props} />,
		),
	);
const chip = () => document.querySelector("[data-testid=chip]")?.textContent;

beforeEach(() => {
	agents = { harnesses: [claude], effective: undefined, model: "" };
	create.mockReset().mockResolvedValue({});
	root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
	act(() => root.unmount());
	document.body.innerHTML = "";
});

describe("ScheduleDialog (#979)", () => {
	it("a new schedule takes the default agent when it arrives after the dialog opened", async () => {
		await render();
		expect(chip()).toBe("none:");

		agents = { ...agents, effective: claude, model: "sonnet" };
		await render();

		expect(chip()).toBe("claude-code:sonnet");
	});

	it("a late default never overwrites the agent of a duplicated schedule", async () => {
		agents = {
			harnesses: [claude, { id: "codex", label: "Codex" }],
			effective: undefined,
			model: "",
		};
		await render({
			copyOf: { ...source, harness: "codex", model: null } as Schedule,
		});

		agents = { ...agents, effective: claude, model: "sonnet" };
		await render({
			copyOf: { ...source, harness: "codex", model: null } as Schedule,
		});

		expect(chip()).toBe("codex:");
	});

	it("Duplicate keeps the source's effort and catch-up window", async () => {
		await render({ copyOf: source });

		const button = Array.from(document.querySelectorAll("button")).find(
			(b) => b.textContent === "Create schedule",
		);
		await act(async () => button?.click());

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Morning check (copy)",
				effort: "high",
				catchUpMinutes: 90,
			}),
		);
	});
});
