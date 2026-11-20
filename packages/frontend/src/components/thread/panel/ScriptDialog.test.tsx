// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	PROJECT_SCRIPT_COMMAND_MAX,
	PROJECT_SCRIPT_NAME_MAX,
} from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptDialog, scriptErrors } from "./ScriptDialog";

const { addScriptSpy, updateScriptSpy, removeScriptSpy } = vi.hoisted(() => ({
	addScriptSpy: vi.fn().mockResolvedValue({ id: "script-1" }),
	updateScriptSpy: vi.fn().mockResolvedValue({ id: "script-1" }),
	removeScriptSpy: vi.fn().mockResolvedValue({ id: "script-1" }),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/dialog", () => {
	const Pass = ({ children }: { children?: React.ReactNode }) => (
		<>{children}</>
	);
	return {
		Dialog: Pass,
		DialogContent: ({ children, ...props }: React.ComponentProps<"div">) => (
			<div {...props}>{children}</div>
		),
		DialogDescription: Pass,
		DialogHeader: Pass,
		DialogTitle: ({ children }: { children?: React.ReactNode }) => (
			<h2>{children}</h2>
		),
		DialogFooter: Pass,
	};
});

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		repositories: {
			addScript: {
				call: addScriptSpy,
			},
			updateScript: {
				call: updateScriptSpy,
			},
			removeScript: {
				call: removeScriptSpy,
			},
			scripts: {
				key: () => ["repositories", "scripts"],
			},
		},
		threads: {
			context: {
				key: () => ["threads", "context"],
			},
		},
	},
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("scriptErrors", () => {
	it("returns empty errors for valid name and command", () => {
		const errors = scriptErrors("dev", "pnpm dev");
		expect(errors.name).toBeUndefined();
		expect(errors.command).toBeUndefined();
	});

	it("returns validation error when name is empty or whitespace", () => {
		const errors = scriptErrors("   ", "pnpm dev");
		expect(errors.name).toBe("Name it");
		expect(errors.command).toBeUndefined();
	});

	it("returns validation error when name exceeds max length", () => {
		const longName = "a".repeat(PROJECT_SCRIPT_NAME_MAX + 1);
		const errors = scriptErrors(longName, "pnpm dev");
		expect(errors.name).toBe(`At most ${PROJECT_SCRIPT_NAME_MAX} characters`);
	});

	it("returns validation error when command is empty or whitespace", () => {
		const errors = scriptErrors("dev", "  ");
		expect(errors.name).toBeUndefined();
		expect(errors.command).toBe("Type a command");
	});

	it("returns validation error when command exceeds max length", () => {
		const longCmd = "a".repeat(PROJECT_SCRIPT_COMMAND_MAX + 1);
		const errors = scriptErrors("dev", longCmd);
		expect(errors.command).toBe(
			`At most ${PROJECT_SCRIPT_COMMAND_MAX} characters`,
		);
	});

	it("returns validation error when command contains newlines or control characters", () => {
		const errors = scriptErrors("dev", "pnpm dev\npnpm test");
		expect(errors.command).toBe("One line, no control characters");
	});
});

describe("ScriptDialog", () => {
	let container: HTMLDivElement;
	let queryClient: QueryClient;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		vi.clearAllMocks();
		return () => {
			container.remove();
		};
	});

	function renderDialog(props: {
		projectId: string;
		script?: { id: string; name: string; command: string };
		onClose: () => void;
	}) {
		const root = createRoot(container);
		act(() => {
			root.render(
				<QueryClientProvider client={queryClient}>
					<ScriptDialog {...props} />
				</QueryClientProvider>,
			);
		});
		return root;
	}

	it("renders add script mode with empty inputs", () => {
		const onClose = vi.fn();
		renderDialog({ projectId: "proj-123", onClose });

		const title = container.querySelector("h2");
		expect(title?.textContent).toBe("Add script");

		const nameInput = container.querySelector(
			'[data-testid="script-name"]',
		) as HTMLInputElement | null;
		const commandInput = container.querySelector(
			'[data-testid="script-command"]',
		) as HTMLInputElement | null;

		expect(nameInput?.value).toBe("");
		expect(commandInput?.value).toBe("");
	});

	it("renders edit script mode with prepopulated values", () => {
		const onClose = vi.fn();
		renderDialog({
			projectId: "proj-123",
			script: { id: "s-1", name: "test", command: "pnpm test" },
			onClose,
		});

		const title = container.querySelector("h2");
		expect(title?.textContent).toBe("Edit script");

		const nameInput = container.querySelector(
			'[data-testid="script-name"]',
		) as HTMLInputElement | null;
		const commandInput = container.querySelector(
			'[data-testid="script-command"]',
		) as HTMLInputElement | null;

		expect(nameInput?.value).toBe("test");
		expect(commandInput?.value).toBe("pnpm test");
	});

	it("shows validation error messages when submitting empty form", () => {
		const onClose = vi.fn();
		renderDialog({ projectId: "proj-123", onClose });

		const form = container.querySelector("form");
		act(() => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		const nameErr = container.querySelector(
			'[data-testid="script-name-error"]',
		);
		const cmdErr = container.querySelector(
			'[data-testid="script-command-error"]',
		);

		expect(nameErr?.textContent).toBe("Name it");
		expect(cmdErr?.textContent).toBe("Type a command");
		expect(addScriptSpy).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("submits valid add form and triggers onClose on success", async () => {
		const onClose = vi.fn();
		renderDialog({ projectId: "proj-123", onClose });

		const nameInput = container.querySelector(
			'[data-testid="script-name"]',
		) as HTMLInputElement | null;
		const commandInput = container.querySelector(
			'[data-testid="script-command"]',
		) as HTMLInputElement | null;

		await act(async () => {
			if (nameInput) {
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(nameInput, "build");
				nameInput.dispatchEvent(new Event("input", { bubbles: true }));
				nameInput.dispatchEvent(new Event("change", { bubbles: true }));
			}
			if (commandInput) {
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(commandInput, "pnpm build");
				commandInput.dispatchEvent(new Event("input", { bubbles: true }));
				commandInput.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});

		const form = container.querySelector("form");
		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		expect(addScriptSpy).toHaveBeenCalledWith({
			id: "proj-123",
			name: "build",
			command: "pnpm build",
		});
		expect(onClose).toHaveBeenCalled();
	});

	it("submits valid update form and triggers onClose on success", async () => {
		const onClose = vi.fn();
		renderDialog({
			projectId: "proj-123",
			script: { id: "s-1", name: "test", command: "pnpm test" },
			onClose,
		});

		const commandInput = container.querySelector(
			'[data-testid="script-command"]',
		) as HTMLInputElement | null;

		await act(async () => {
			if (commandInput) {
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(commandInput, "pnpm test:unit");
				commandInput.dispatchEvent(new Event("input", { bubbles: true }));
				commandInput.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});

		const form = container.querySelector("form");
		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		expect(updateScriptSpy).toHaveBeenCalledWith({
			id: "proj-123",
			scriptId: "s-1",
			name: "test",
			command: "pnpm test:unit",
		});
		expect(onClose).toHaveBeenCalled();
	});

	it("displays server error when save mutation fails", async () => {
		addScriptSpy.mockRejectedValueOnce(
			new Error("Database error saving script"),
		);
		const onClose = vi.fn();
		renderDialog({ projectId: "proj-123", onClose });

		const nameInput = container.querySelector(
			'[data-testid="script-name"]',
		) as HTMLInputElement | null;
		const commandInput = container.querySelector(
			'[data-testid="script-command"]',
		) as HTMLInputElement | null;

		await act(async () => {
			if (nameInput) {
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(nameInput, "build");
				nameInput.dispatchEvent(new Event("input", { bubbles: true }));
				nameInput.dispatchEvent(new Event("change", { bubbles: true }));
			}
			if (commandInput) {
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(commandInput, "pnpm build");
				commandInput.dispatchEvent(new Event("input", { bubbles: true }));
				commandInput.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});

		const form = container.querySelector("form");
		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		const errEl = container.querySelector('[data-testid="script-error"]');
		expect(errEl?.textContent).toBe("Database error saving script");
		expect(onClose).not.toHaveBeenCalled();
	});
});
