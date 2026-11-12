// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ColdResumeRow,
	CompactIdleRow,
	idleCompactionApplies,
	ResumeAfterLimitRow,
} from "./ConversationSettings";

const mutateSpy = vi.fn();
const mockSettings: Record<string, unknown> = {};

vi.mock("@/lib/api/hooks", () => ({
	useHarnessSettings: () => ({ data: mockSettings }),
	useUpdateHarnessSettings: () => ({ mutate: mutateSpy, isPending: false }),
}));

vi.mock("@/components/ui/select", async () => {
	const ReactModule = await import("react");
	const Ctx = ReactModule.createContext<{
		value?: string;
		onValueChange?: (v: string) => void;
		disabled?: boolean;
		labels: Map<string, React.ReactNode>;
	}>({ labels: new Map() });

	function collectLabels(
		children: React.ReactNode,
		map: Map<string, React.ReactNode>,
	) {
		ReactModule.Children.forEach(children, (child) => {
			if (!ReactModule.isValidElement(child)) return;
			const props = child.props as {
				value?: unknown;
				children?: React.ReactNode;
			};
			if (props?.value !== undefined && props?.children !== undefined) {
				map.set(String(props.value), props.children);
			}
			if (props?.children) {
				collectLabels(props.children, map);
			}
		});
	}

	return {
		Select: ({
			value,
			onValueChange,
			disabled,
			children,
		}: {
			value?: string;
			onValueChange?: (v: string) => void;
			disabled?: boolean;
			children: React.ReactNode;
		}) => {
			const labels = new Map<string, React.ReactNode>();
			collectLabels(children, labels);
			return (
				<Ctx.Provider value={{ value, onValueChange, disabled, labels }}>
					<div data-testid="select-root" data-value={value}>
						{children}
					</div>
				</Ctx.Provider>
			);
		},
		SelectTrigger: ({
			children,
			className,
			"data-testid": testId,
		}: {
			children?: React.ReactNode;
			className?: string;
			"data-testid"?: string;
		}) => {
			const ctx = ReactModule.useContext(Ctx);
			return (
				<button
					type="button"
					data-testid={testId}
					className={className}
					disabled={ctx.disabled}
				>
					{children}
				</button>
			);
		},
		SelectValue: () => {
			const ctx = ReactModule.useContext(Ctx);
			const label =
				ctx.value != null ? ctx.labels.get(String(ctx.value)) : undefined;
			return <span>{label ?? ctx.value ?? ""}</span>;
		},
		SelectContent: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
		SelectItem: ({
			value,
			children,
		}: {
			value: string;
			children: React.ReactNode;
		}) => {
			const ctx = ReactModule.useContext(Ctx);
			return (
				<button
					type="button"
					data-value={value}
					disabled={ctx.disabled}
					onClick={() => ctx.onValueChange?.(value)}
				>
					{children}
				</button>
			);
		},
	};
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mutateSpy.mockClear();
	for (const k of Object.keys(mockSettings)) delete mockSettings[k];
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ConversationSettings", () => {
	it("shows Ask when coldResume is absent and choosing Send as is sends coldResume send", async () => {
		await act(async () => {
			root.render(<ColdResumeRow />);
		});
		const trigger = container.querySelector(
			'[data-testid="harness-cold-resume"]',
		);
		expect(trigger?.textContent).toContain("Ask");

		const option = container.querySelector<HTMLButtonElement>(
			'button[data-value="send"]',
		);
		await act(async () => {
			option?.click();
		});
		expect(mutateSpy).toHaveBeenCalledWith({ coldResume: "send" });
	});

	it("renders switch checked when resumeAfterLimit is absent and clicking sends resumeAfterLimit false", async () => {
		await act(async () => {
			root.render(<ResumeAfterLimitRow />);
		});
		const toggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="harness-resume-after-limit"]',
		);
		expect(toggle?.getAttribute("aria-checked")).toBe("true");

		await act(async () => {
			toggle?.click();
		});
		expect(mutateSpy).toHaveBeenCalledWith({ resumeAfterLimit: false });
	});

	it("evaluates idle compaction applicability for absent caches, uncompacted agents, and default registry", () => {
		expect(
			idleCompactionApplies({
				agentA: { cacheTtlMinutes: null, compactsWhenIdle: false },
				agentB: { cacheTtlMinutes: null, compactsWhenIdle: true },
			}),
		).toBe(false);

		expect(
			idleCompactionApplies({
				agentA: { cacheTtlMinutes: 60, compactsWhenIdle: false },
			}),
		).toBe(true);

		expect(
			idleCompactionApplies({
				agentA: { cacheTtlMinutes: 60, compactsWhenIdle: true },
			}),
		).toBe(false);

		expect(idleCompactionApplies()).toBe(false);
	});

	it("renders nothing when compaction does not apply and mutates when applied", async () => {
		await act(async () => {
			root.render(<CompactIdleRow applies={false} />);
		});
		expect(
			container.querySelector('[data-testid="harness-compact-idle-row"]'),
		).toBeNull();

		await act(async () => {
			root.render(<CompactIdleRow applies={true} />);
		});
		expect(
			container.querySelector('[data-testid="harness-compact-idle-row"]'),
		).not.toBeNull();

		const toggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="harness-compact-idle"]',
		);
		await act(async () => {
			toggle?.click();
		});
		expect(mutateSpy).toHaveBeenCalledWith({ compactIdle: true });
	});

	// 2ef62511e moves setting explanations behind Help (?) popovers.
	it("disables each row control and displays host note when runtime editing is forbidden", async () => {
		mockSettings.canEditRuntime = false;

		await act(async () => {
			root.render(
				<>
					<ColdResumeRow />
					<ResumeAfterLimitRow />
					<CompactIdleRow applies={true} />
				</>,
			);
		});

		const coldTrigger = container.querySelector<HTMLButtonElement>(
			'[data-testid="harness-cold-resume"]',
		);
		const limitToggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="harness-resume-after-limit"]',
		);
		const idleToggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="harness-compact-idle"]',
		);

		expect(coldTrigger?.disabled).toBe(true);
		expect(limitToggle?.disabled).toBe(true);
		expect(idleToggle?.disabled).toBe(true);

		const helpBtn = container.querySelector<HTMLButtonElement>(
			'button[data-testid="help"]',
		);
		expect(helpBtn).not.toBeNull();
		await act(async () => {
			helpBtn?.click();
		});
		expect(document.body.textContent).toContain(
			"Only the computer running PrismaLens can change this.",
		);
	});
});
