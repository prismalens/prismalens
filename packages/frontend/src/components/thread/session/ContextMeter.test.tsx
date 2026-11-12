// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMeter, MeterRing } from "./ContextMeter";

// The kit popover portals through Radix; render it in place so the content is queryable.
vi.mock("@/components/kit/Popover", () => ({
	KitPopover: ({
		trigger,
		open = false,
		children,
		contentProps,
	}: {
		trigger: ReactNode;
		open?: boolean;
		children: ReactNode;
		contentProps?: Record<string, unknown>;
	}) => (
		<>
			{trigger}
			{open && (
				<div data-testid={contentProps?.["data-testid"] as string}>
					{children}
				</div>
			)}
		</>
	),
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
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
});

describe("ContextMeter", () => {
	it("ContextMeter with usage {used: 142000, size: 200000}, open true: the trigger reads 142k / 200k · 71%, the popover line is 142k of 200k (71%)", async () => {
		await act(async () =>
			root.render(
				<ContextMeter usage={{ used: 142_000, size: 200_000 }} open={true} />,
			),
		);
		const trigger = container.querySelector('[data-testid="context-meter"]');
		expect(trigger?.textContent).toBe("142k / 200k · 71%");
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
});
