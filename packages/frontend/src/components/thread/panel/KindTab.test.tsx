// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContext } from "@prismalens/contracts";
import { act, createContext, type ReactNode, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KindTab, recurrenceLine } from "./KindTab";

const { mutateEditScriptSpy, editState } = vi.hoisted(() => ({
	mutateEditScriptSpy: vi.fn(),
	editState: { isPending: false },
}));

vi.mock("@/lib/api/hooks/use-project-scripts", () => ({
	useEditProjectScript: vi.fn(() => ({
		mutate: mutateEditScriptSpy,
		isPending: editState.isPending,
	})),
}));

vi.mock("@/components/ui/alert-dialog", () => {
	const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
	const Close = createContext<(open: boolean) => void>(() => {});
	return {
		// A dismissal (Cancel, Escape) reaches `onOpenChange(false)`, as in the real dialog.
		AlertDialog: ({
			children,
			onOpenChange,
		}: {
			children?: ReactNode;
			onOpenChange: (open: boolean) => void;
		}) => (
			<Close.Provider value={onOpenChange}>
				<button
					type="button"
					data-testid="mock-escape"
					onClick={() => onOpenChange(false)}
				/>
				{children}
			</Close.Provider>
		),
		AlertDialogContent: ({
			children,
			...props
		}: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
		AlertDialogHeader: Pass,
		AlertDialogTitle: Pass,
		AlertDialogDescription: Pass,
		AlertDialogFooter: Pass,
		AlertDialogCancel: ({
			children,
			disabled,
		}: React.ComponentProps<"button">) => {
			const close = useContext(Close);
			return (
				<button
					type="button"
					data-testid="script-remove-cancel"
					disabled={disabled}
					onClick={() => close(false)}
				>
					{children}
				</button>
			);
		},
		AlertDialogAction: ({
			children,
			onClick,
			...props
		}: React.ComponentProps<"button">) => (
			<button type="button" onClick={onClick} {...props}>
				{children}
			</button>
		),
	};
});

vi.mock("./ScriptDialog", () => ({
	ScriptDialog: ({
		projectId,
		script,
		onClose,
	}: {
		projectId: string;
		script?: { id: string; name: string; command: string };
		onClose: () => void;
	}) => (
		<div
			data-testid="mock-script-dialog"
			data-project-id={projectId}
			data-script-id={script?.id}
			data-script-name={script?.name}
			data-script-command={script?.command}
		>
			<button type="button" data-testid="mock-dialog-close" onClick={onClose}>
				Close
			</button>
		</div>
	),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => children,
}));

// Severity and run outcomes are kit marks with a hint since 0f01b2f73.
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/terminal/RunInTerminal", () => ({
	RunInTerminal: ({ command }: { command: string }) => (
		<span data-testid="run-terminal">{command}</span>
	),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	editState.isPending = false;
	mutateEditScriptSpy.mockReset();
	await act(async () => root.unmount());
	container.remove();
});

const baseContext = {
	threadId: "th-1",
	title: "Thread",
	machine: { hostName: "host-1", os: "linux" as const, isHost: true },
	agent: { harness: "agent", model: "model-1", effort: null },
	workspace: null,
	lineage: [],
	plan: null,
	pullRequests: [],
};

describe("recurrenceLine (#1024)", () => {
	it.each([
		[
			{ type: "cron" as const, expr: "0 9 * * 1-5", timezone: "UTC" },
			"0 9 * * 1-5 (UTC)",
		],
		[
			{
				type: "interval" as const,
				everyMinutes: 60,
				anchorAt: "2026-11-10T00:00:00.000Z",
			},
			"Every hour",
		],
		[
			{
				type: "interval" as const,
				everyMinutes: 1440,
				anchorAt: "2026-11-10T00:00:00.000Z",
			},
			"Every day",
		],
		[
			{
				type: "interval" as const,
				everyMinutes: 90,
				anchorAt: "2026-11-10T00:00:00.000Z",
			},
			"Every 90 minutes",
		],
		[null, "Runs only when started"],
	])("recurrenceLine for %j returns %s", (recurrence, expected) => {
		expect(recurrenceLine(recurrence)).toBe(expected);
	});
});

describe("KindTab (#1024)", () => {
	it("renders kind-tab-incident with INC-7 CheckoutLatencyHigh, its severity mark, a suspect statement, and its status word", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "incident",
			incident: {
				id: "inc-7",
				number: 7,
				title: "CheckoutLatencyHigh",
				severity: "high",
				status: "investigating",
				alertCount: 2,
				impact: null,
			},
			suspects: [
				{
					id: "s1",
					statement: "Database connection pool exhausted",
					status: "supported",
				},
			],
			report: "ready",
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-incident"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("INC-7 CheckoutLatencyHigh");
		expect(
			container
				.querySelector('[data-testid="kind-severity"]')
				?.getAttribute("aria-label"),
		).toBe("Severity: High");
		const suspect = container.querySelector('[data-testid="suspect"]');
		expect(suspect?.textContent).toBe(
			"SupportedDatabase connection pool exhausted",
		);
	});

	it("renders kind-tab-schedule with recurrence line and last runs", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "schedule",
			schedule: {
				id: "sch-1",
				name: "Morning check",
				recurrence: {
					type: "cron",
					expr: "0 9 * * 1-5",
					timezone: "UTC",
				},
				nextRunAt: null,
				lastRuns: [],
			},
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-schedule"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("0 9 * * 1-5 (UTC)");
	});

	it("renders kind-tab-service with service owner and a dependency", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "service",
			service: {
				id: "srv-1",
				name: "Billing Service",
				tier: "tier-1",
				owner: "Payment Platform",
				dependencies: [{ id: "dep-1", name: "auth-service" }],
			},
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-service"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("Payment Platform");
		expect(container.textContent).toContain("auth-service");
	});

	it("renders kind-tab-project with a script command", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [{ runner: "pnpm", name: "build", command: "pnpm build" }],
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const el = container.querySelector('[data-testid="kind-tab-project"]');
		expect(el).not.toBeNull();
		expect(container.textContent).toContain("pnpm build");
	});

	it("renders stored scripts with edit and remove buttons for machine owner", async () => {
		const context: ThreadContext = {
			...baseContext,
			machine: { ...baseContext.machine, isOwner: true },
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [
				{
					id: "s-1",
					runner: "custom",
					name: "unit tests",
					command: "pnpm test:unit",
				},
				{ runner: "pnpm", name: "build", command: "pnpm build" },
			],
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const rows = container.querySelectorAll('[data-testid="script-row"]');
		expect(rows.length).toBe(2);

		const storedRow = rows[0];
		const detectedRow = rows[1];

		expect(storedRow?.getAttribute("data-runner")).toBe("custom");
		expect(
			storedRow?.querySelector('[data-testid="script-edit"]'),
		).not.toBeNull();
		expect(
			storedRow?.querySelector('[data-testid="script-remove-open"]'),
		).not.toBeNull();

		expect(detectedRow?.getAttribute("data-runner")).toBe("pnpm");
		expect(
			detectedRow?.querySelector('[data-testid="script-edit"]'),
		).toBeNull();
		expect(
			detectedRow?.querySelector('[data-testid="script-remove-open"]'),
		).toBeNull();
	});

	it("renders empty state 'No scripts yet' when scripts list is empty", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [],
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		expect(container.textContent).toContain("No scripts yet");
	});

	it("renders Add script button only for machine owner and opens ScriptDialog", async () => {
		const nonOwnerContext: ThreadContext = {
			...baseContext,
			machine: { ...baseContext.machine, isOwner: false },
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [],
		};

		await act(async () => {
			root.render(<KindTab context={nonOwnerContext} />);
		});

		expect(container.querySelector('[data-testid="script-add"]')).toBeNull();

		const ownerContext: ThreadContext = {
			...baseContext,
			machine: { ...baseContext.machine, isOwner: true },
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [],
		};

		await act(async () => {
			root.render(<KindTab context={ownerContext} />);
		});

		const addBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="script-add"]',
		);
		expect(addBtn).not.toBeNull();

		await act(async () => {
			addBtn?.click();
		});
		await act(() => new Promise((r) => setTimeout(r, 0)));

		const dialog = container.querySelector(
			'[data-testid="mock-script-dialog"]',
		);
		expect(dialog?.getAttribute("data-project-id")).toBe("proj-1");
		expect(dialog?.getAttribute("data-script-id")).toBeNull();

		const closeBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="mock-dialog-close"]',
		);
		await act(async () => {
			closeBtn?.click();
		});
		expect(
			container.querySelector('[data-testid="mock-script-dialog"]'),
		).toBeNull();
	});

	it("opens ScriptDialog with script when edit button is clicked", async () => {
		const context: ThreadContext = {
			...baseContext,
			machine: { ...baseContext.machine, isOwner: true },
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [
				{
					id: "s-1",
					runner: "custom",
					name: "unit tests",
					command: "pnpm test:unit",
				},
			],
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const editBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="script-edit"]',
		);
		await act(async () => {
			editBtn?.click();
		});
		await act(() => new Promise((r) => setTimeout(r, 0)));

		const dialog = container.querySelector(
			'[data-testid="mock-script-dialog"]',
		);
		expect(dialog?.getAttribute("data-project-id")).toBe("proj-1");
		expect(dialog?.getAttribute("data-script-id")).toBe("s-1");
		expect(dialog?.getAttribute("data-script-name")).toBe("unit tests");
		expect(dialog?.getAttribute("data-script-command")).toBe("pnpm test:unit");
	});

	it("opens remove confirmation and calls remove mutation on confirm", async () => {
		const context: ThreadContext = {
			...baseContext,
			machine: { ...baseContext.machine, isOwner: true },
			kind: "project",
			project: {
				id: "proj-1",
				name: "Webapp",
			},
			scripts: [
				{
					id: "s-1",
					runner: "custom",
					name: "unit tests",
					command: "pnpm test:unit",
				},
			],
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		const removeOpenBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="script-remove-open"]',
		);
		await act(async () => {
			removeOpenBtn?.click();
		});

		const confirmEl = container.querySelector(
			'[data-testid="script-remove-confirm"]',
		);
		expect(confirmEl).not.toBeNull();
		expect(confirmEl?.textContent).toContain("Remove unit tests?");

		const removeBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="script-remove"]',
		);
		await act(async () => {
			removeBtn?.click();
		});

		expect(mutateEditScriptSpy).toHaveBeenCalledWith(
			{ op: "remove", scriptId: "s-1" },
			expect.objectContaining({ onError: expect.any(Function) }),
		);
	});

	it("keeps the remove confirmation open while the request is pending, so a failure's toast can show", async () => {
		const context: ThreadContext = {
			...baseContext,
			machine: { ...baseContext.machine, isOwner: true },
			kind: "project",
			project: { id: "proj-1", name: "Webapp" },
			scripts: [
				{
					id: "s-1",
					runner: "custom",
					name: "unit tests",
					command: "pnpm test:unit",
				},
			],
		};
		const confirm = () =>
			container.querySelector('[data-testid="script-remove-confirm"]');

		await act(async () => {
			root.render(<KindTab context={context} />);
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[data-testid="script-remove-open"]')
				?.click();
		});
		expect(confirm()).not.toBeNull();

		editState.isPending = true;
		await act(async () => {
			root.render(<KindTab context={context} />);
		});
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="script-remove-cancel"]',
		);
		expect(cancel?.disabled).toBe(true);
		await act(async () => {
			cancel?.click();
			container
				.querySelector<HTMLButtonElement>('[data-testid="mock-escape"]')
				?.click();
		});
		expect(confirm()).not.toBeNull();

		editState.isPending = false;
		await act(async () => {
			root.render(<KindTab context={context} />);
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>(
					'[data-testid="script-remove-cancel"]',
				)
				?.click();
		});
		expect(confirm()).toBeNull();
	});

	it("renders nothing when context kind is none", async () => {
		const context: ThreadContext = {
			...baseContext,
			kind: "none",
			helperPlace: null,
		};

		await act(async () => {
			root.render(<KindTab context={context} />);
		});

		expect(container.innerHTML).toBe("");
	});
});
