// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createContext, type ReactNode, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMeter, ContextTable, MeterRing } from "./ContextMeter";

const PopoverContext = createContext<{ open?: boolean }>({ open: false });

vi.mock("@/components/ui/popover", () => ({
	Popover: ({
		children,
		open = false,
	}: {
		children: ReactNode;
		open?: boolean;
	}) => (
		<PopoverContext.Provider value={{ open }}>
			{children}
		</PopoverContext.Provider>
	),
	PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
	PopoverContent: ({ children, ...props }: React.ComponentProps<"div">) => {
		const ctx = useContext(PopoverContext);
		if (!ctx.open) return null;
		return <div {...props}>{children}</div>;
	},
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
	await act(async () => root.unmount());
	container.remove();
});

describe("MeterRing", () => {
	it.each([
		[69, "neutral"],
		[70, "warn"],
		[91, "danger"],
	] as const)(
		"MeterRing data-tone is %s for %i percent",
		async (percent, tone) => {
			await act(async () => root.render(<MeterRing percent={percent} />));
			const ring = container.querySelector(
				'[data-testid="context-meter-ring"]',
			);
			expect(ring?.getAttribute("data-tone")).toBe(tone);
		},
	);

	it("MeterRing with autoAt=85 has tone neutral at 74, warn at 75, danger at 85, and tick element present", async () => {
		await act(async () => root.render(<MeterRing percent={74} autoAt={85} />));
		let ring = container.querySelector('[data-testid="context-meter-ring"]');
		expect(ring?.getAttribute("data-tone")).toBe("neutral");
		expect(
			container.querySelector('[data-testid="context-meter-auto"]'),
		).not.toBeNull();

		await act(async () => root.render(<MeterRing percent={75} autoAt={85} />));
		ring = container.querySelector('[data-testid="context-meter-ring"]');
		expect(ring?.getAttribute("data-tone")).toBe("warn");

		await act(async () => root.render(<MeterRing percent={85} autoAt={85} />));
		ring = container.querySelector('[data-testid="context-meter-ring"]');
		expect(ring?.getAttribute("data-tone")).toBe("danger");
	});
});

describe("ContextMeter", () => {
	it("ContextMeter with usage {used: 142000, size: 200000}, open true: the trigger reads 71%, the popover line is 142k of 200k (71%)", async () => {
		await act(async () =>
			root.render(
				<ContextMeter usage={{ used: 142_000, size: 200_000 }} open={true} />,
			),
		);
		const trigger = container.querySelector('[data-testid="context-meter"]');
		expect(trigger?.textContent).toBe("71%");
		const line = container.querySelector('[data-testid="context-meter-line"]');
		expect(line?.textContent).toBe("142k of 200k (71%)");
	});

	it("Cache warm shows Cache warm", async () => {
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					session={{ cache: "warm" }}
					open={true}
				/>,
			),
		);
		const cache = container.querySelector(
			'[data-testid="context-meter-cache"]',
		);
		expect(cache?.textContent).toBe("Cache warm");
	});

	it("cache unknown says the cache state is not reported (#1101)", async () => {
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					session={{ cache: "unknown" }}
					open={true}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="context-meter-cache"]')
				?.textContent,
		).toBe("Cache state not reported");
	});

	it("without compactCommand there is no context-meter-compact", async () => {
		const onCompact = vi.fn();
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					session={{ cache: "unknown", compactCommand: undefined }}
					onCompact={onCompact}
					open={true}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="context-meter-compact"]'),
		).toBeNull();
	});

	it("with compactCommand compact and onCompact it shows", async () => {
		const onCompact = vi.fn();
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					session={{ cache: "unknown", compactCommand: "compact" }}
					onCompact={onCompact}
					open={true}
				/>,
			),
		);
		const button = container.querySelector(
			'[data-testid="context-meter-compact"]',
		);
		expect(button?.textContent).toBe("Compact");
	});

	it("without compactTakesFocus there is no context-meter-focus and clicking Compact calls onCompact with undefined", async () => {
		const onCompact = vi.fn();
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					session={{ cache: "unknown", compactCommand: "compact" }}
					onCompact={onCompact}
					compactTakesFocus={false}
					open={true}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="context-meter-focus"]'),
		).toBeNull();
		const button = container.querySelector(
			'[data-testid="context-meter-compact"]',
		) as HTMLButtonElement;
		await act(async () => {
			button.click();
		});
		expect(onCompact).toHaveBeenCalledTimes(1);
		expect(onCompact).toHaveBeenCalledWith(undefined);
	});

	it("with compactTakesFocus, typing keep the API notes then Compact calls onCompact with keep the API notes", async () => {
		const onCompact = vi.fn();
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					session={{ cache: "unknown", compactCommand: "compact" }}
					onCompact={onCompact}
					compactTakesFocus={true}
					open={true}
				/>,
			),
		);
		const textarea = container.querySelector(
			'[data-testid="context-meter-focus"]',
		) as HTMLTextAreaElement;
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			set?.call(textarea, "keep the API notes");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(textarea.value).toBe("keep the API notes");
		const button = container.querySelector(
			'[data-testid="context-meter-compact"]',
		) as HTMLButtonElement;
		await act(async () => {
			button.click();
		});
		expect(onCompact).toHaveBeenCalledTimes(1);
		expect(onCompact).toHaveBeenCalledWith("keep the API notes");
	});

	it("running disables Compact", async () => {
		const onCompact = vi.fn();
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					session={{ cache: "unknown", compactCommand: "compact" }}
					onCompact={onCompact}
					running={true}
					open={true}
				/>,
			),
		);
		const button = container.querySelector(
			'[data-testid="context-meter-compact"]',
		) as HTMLButtonElement;
		expect(button?.disabled).toBe(true);
	});

	it("ContextMeter with usage null reads 'Context' and line '<agent> does not report its context use.'", async () => {
		await act(async () =>
			root.render(
				<ContextMeter usage={null} agent="Claude Code" open={true} />,
			),
		);
		const trigger = container.querySelector('[data-testid="context-meter"]');
		expect(trigger?.textContent).toBe("Context");
		const line = container.querySelector('[data-testid="context-meter-line"]');
		expect(line?.textContent).toBe(
			"Claude Code does not report its context use.",
		);
	});

	it("renders auto line 'Compacts by itself at 170k (85%)' for size 200000 autoAt 85", async () => {
		await act(async () =>
			root.render(
				<ContextMeter
					usage={{ used: 50_000, size: 200_000 }}
					autoAt={85}
					open={true}
				/>,
			),
		);
		const autoLine = container.querySelector(
			'[data-testid="context-meter-auto-line"]',
		);
		expect(autoLine?.textContent).toBe("Compacts by itself at 170k (85%)");
	});
});

describe("ContextTable (#1101)", () => {
	it("ContextTable renders a row per category and Largest items", async () => {
		const breakdown = {
			used: 120_000,
			size: 200_000,
			free: 80_000,
			rows: [
				{ category: "brief" as const, tokens: 2000, percent: 1 },
				{ category: "tools" as const, tokens: 10_000, percent: 5 },
			],
			largest: [
				{ label: "runbooks.md", category: "tools" as const, tokens: 6000 },
			],
			trim: null,
		};

		await act(async () => {
			root.render(<ContextTable breakdown={breakdown} />);
		});

		const table = container.querySelector('[data-testid="context-breakdown"]');
		expect(table).not.toBeNull();
		const briefRow = container.querySelector('tr[data-category="brief"]');
		expect(briefRow?.textContent).toContain("Brief and alert");
		expect(briefRow?.textContent).toContain("2k");
		expect(briefRow?.textContent).toContain("1%");

		const toolsRow = container.querySelector('tr[data-category="tools"]');
		expect(toolsRow?.textContent).toContain("Other tool results");
		expect(toolsRow?.textContent).toContain("10k");
		expect(toolsRow?.textContent).toContain("5%");

		const largest = container.querySelector('[data-testid="context-largest"]');
		expect(largest?.textContent).toContain("Largest items");
		expect(largest?.textContent).toContain("runbooks.md");
		expect(largest?.textContent).toContain("6k");
	});
});
