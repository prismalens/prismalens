// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettings } from "./GeneralSettings";

const updateSpy = vi.fn();
let mockEditors: { id: string; label: string; command: string }[] = [
	{ id: "vscode", label: "VS Code", command: "code" },
];
let mockSettings: { prStatus: boolean; editor: string } = {
	prStatus: true,
	editor: "system",
};
const mockOperator = { managesPairing: true };

vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useEditors: () => ({ data: { editors: mockEditors } }),
	useThreadContextSettings: () => ({ data: mockSettings }),
	useUpdateThreadContextSettings: () => ({
		mutate: updateSpy,
		isPending: false,
	}),
}));

vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useThreadSettings: () => ({
		data: { settleAfterDays: 7 },
		isPending: false,
	}),
	useUpdateThreadSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-layout-prefs", () => ({
	useLayoutPrefs: () => ({
		sidebarRest: "full",
		setSidebarRest: vi.fn(),
	}),
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => mockOperator,
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
	updateSpy.mockClear();
	mockEditors = [{ id: "vscode", label: "VS Code", command: "code" }];
	mockSettings = { prStatus: true, editor: "system" };
	mockOperator.managesPairing = true;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("GeneralSettings (FilesGroup)", () => {
	it("shows System default in Open files in and calls mutate when choosing an available editor", async () => {
		await act(async () => {
			root.render(<GeneralSettings />);
		});

		const trigger = container.querySelector('[data-testid="general-editor"]');
		expect(trigger?.textContent).toContain("System default");

		const option = container.querySelector<HTMLButtonElement>(
			'button[data-value="vscode"]',
		);
		await act(async () => {
			option?.click();
		});
		expect(updateSpy).toHaveBeenCalledWith({ editor: "vscode" });
	});

	it("lists missing editor with not found suffix when saved editor is not on PATH", async () => {
		mockSettings = { prStatus: true, editor: "zed" };
		mockEditors = [];

		await act(async () => {
			root.render(<GeneralSettings />);
		});

		const trigger = container.querySelector('[data-testid="general-editor"]');
		expect(trigger?.textContent).toContain("zed (not found)");

		const option = container.querySelector<HTMLButtonElement>(
			'button[data-value="zed"]',
		);
		expect(option?.textContent).toBe("zed (not found)");
	});
});
