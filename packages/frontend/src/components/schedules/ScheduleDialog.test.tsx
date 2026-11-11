// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Schedule } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aboutOf, nameFrom, ScheduleDialog } from "./ScheduleDialog";

// Each render mounts the whole dialog: well past 5s on a cold macOS runner.
vi.setConfig({ testTimeout: 30_000 });

type Agent = { id: string; label: string };
let agents: {
	harnesses: Agent[];
	effective: Agent | undefined;
	model: string;
};
const create = vi.fn();
const SERVICE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const FOLDER = "33333333-3333-4333-8333-333333333333";

vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => ({ axes: { accessLevels: {} }, ...agents }),
	defaultAccessOf: () => ({
		level: { level: "supervised", from: "prismalens" },
	}),
	ModelChip: ({ harness, model }: { harness?: Agent; model: string }) => (
		<span data-testid="chip">{`${harness?.id ?? "none"}:${model}`}</span>
	),
	EffortChip: () => null,
	AccessChip: ({ level }: { level: string }) => (
		<span data-testid="access-chip">{level}</span>
	),
	effortLevels: () => [],
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/api/hooks", () => ({
	useServices: () => ({ data: { data: [{ id: SERVICE, name: "checkout" }] } }),
	useRepositories: () => ({
		data: {
			data: [
				{
					id: PROJECT,
					fullName: "acme/shop",
					sourceKind: "url",
					url: "https://x/shop.git",
					plain: false,
				},
				{
					id: FOLDER,
					fullName: "notes",
					sourceKind: "folder",
					url: "/notes",
					plain: true,
				},
			],
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
	serviceId: SERVICE,
	repositoryId: null,
	serviceName: "checkout",
	runbook: null,
	brief: "Look at the pool",
	recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
	harness: "claude-code",
	model: "opus",
	effort: "high",
	accessLevel: null,
	report: true,
	whenAsks: "decide",
	missedPolicy: "skip",
	catchUpMinutes: 90,
} as unknown as Schedule;

let root: Root;
const render = (props: Partial<Parameters<typeof ScheduleDialog>[0]> = {}) =>
	act(async () => {
		root.render(
			<ScheduleDialog open onOpenChange={() => {}} canSetHostZone {...props} />,
		);
		await new Promise((r) => setTimeout(r, 0));
	});
const chip = () => document.querySelector("[data-testid=chip]")?.textContent;
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const send = () =>
	act(async () =>
		(
			document.querySelector(
				'[aria-label="Create schedule"]',
			) as HTMLButtonElement
		)?.click(),
	);
async function typeIn(el: Element | null, text: string) {
	if (!el) throw new Error("No composer input to type into");
	const editor = (
		el as HTMLElement & { editor?: import("@tiptap/core").Editor }
	).editor;
	if (editor) {
		await act(async () => {
			editor.commands.insertContent(text);
		});
		return;
	}
	await act(async () => {
		const proto =
			el instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
		el?.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

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

	it("a seeded schedule keeps its own agent default (model null) when the default agent is already loaded", async () => {
		agents = {
			harnesses: [claude, { id: "codex", label: "Codex" }],
			effective: claude,
			model: "sonnet",
		};
		await render({
			copyOf: { ...source, harness: "codex", model: null } as Schedule,
		});
		expect(chip()).toBe("codex:");
		await send();
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ harness: "codex", model: null }),
		);
	});

	it("the Run once help names the schedule's own catch-up window, 6 hours for a new one", async () => {
		await render();
		expect(document.body.textContent).toContain("back within 6 hours.");

		await render({ copyOf: source });
		expect(document.body.textContent).toContain("back within 1 h 30 min.");

		await render({ copyOf: { ...source, catchUpMinutes: 45 } as Schedule });
		expect(document.body.textContent).toContain("back within 45 minutes.");

		await render({ copyOf: { ...source, catchUpMinutes: 60 } as Schedule });
		expect(document.body.textContent).toContain("back within 1 hour.");
	});

	it("Duplicate keeps the source's effort, catch-up window, subject, Report and When it asks", async () => {
		await render({
			copyOf: { ...source, report: false, whenAsks: "wait" } as Schedule,
		});
		await send();
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Morning check (copy)",
				effort: "high",
				catchUpMinutes: 90,
				serviceId: SERVICE,
				repositoryId: null,
				report: false,
				whenAsks: "wait",
			}),
		);
	});
});

describe("a schedule is a saved composer (#1020)", () => {
	it("puts the subject and Report above the box, the agent chips inside it, and no attach", async () => {
		await render();
		const box = q("composer-input")?.closest("form");
		expect(box?.contains(q("chip"))).toBe(true);
		expect(box?.contains(q("access-chip"))).toBe(true);
		expect(q("access-chip")?.textContent).toBe("auto");
		expect(box?.contains(q("schedule-subject"))).toBe(false);
		expect(q("schedule-report")?.getAttribute("aria-pressed")).toBe("true");
		expect(q("composer-attach")).toBeNull();
		expect(q("schedule-asks-decide")?.getAttribute("data-state")).toBe(
			"checked",
		);
	});

	it("saves a schedule with no code, Report off, as a chat that waits for you", async () => {
		agents = { ...agents, effective: claude, model: "sonnet" };
		await render();
		await typeIn(document.getElementById("sch-name"), "Weekly summary");
		await typeIn(q("composer-input"), "Summarise the week");
		await act(async () => (q("schedule-report") as HTMLButtonElement).click());
		await act(async () =>
			(q("schedule-asks-wait") as HTMLButtonElement).click(),
		);
		await send();
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Weekly summary",
				brief: "Summarise the week",
				serviceId: null,
				repositoryId: null,
				report: false,
				whenAsks: "wait",
				runbook: null,
				accessLevel: null,
			}),
		);
	});

	it("starts from New thread's box for Repeat…, on its project", async () => {
		agents = { ...agents, effective: claude, model: "sonnet" };
		await render({
			prefill: {
				brief: "Run the tests\nand say what broke",
				subject: { kind: "project", repositoryId: PROJECT },
				accessLevel: "supervised",
			},
		});
		expect(
			(document.getElementById("sch-name") as HTMLInputElement).value,
		).toBe("Run the tests");
		expect(q("access-chip")?.textContent).toBe("supervised");
		await send();
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: PROJECT,
				serviceId: null,
				accessLevel: "supervised",
			}),
		);
	});

	it("never saves on a Folder project, and says why", async () => {
		agents = { ...agents, effective: claude, model: "sonnet" };
		await render({
			prefill: {
				brief: "Tidy notes",
				subject: { kind: "project", repositoryId: FOLDER },
			},
		});
		await send();
		expect(create).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Folder needs git first");
	});

	it("reads the subject and names a schedule from its first line", () => {
		expect(aboutOf({ serviceId: SERVICE, repositoryId: null })).toBe(
			`service:${SERVICE}`,
		);
		expect(aboutOf({ serviceId: null, repositoryId: PROJECT })).toBe(
			`project:${PROJECT}`,
		);
		expect(aboutOf({})).toBe("none");
		expect(nameFrom("x".repeat(80))).toHaveLength(60);
	});
});
