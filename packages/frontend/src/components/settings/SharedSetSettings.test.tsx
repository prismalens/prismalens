// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	SharedMcpServerView,
	SharedServerPreview,
	SharedSet,
	SharedSource,
} from "@prismalens/contracts";
import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SharedSetSettings,
	SharedSetView,
	ShareServerForm,
} from "./SharedSetSettings";

const live = vi.hoisted(() => ({
	set: undefined as unknown,
	sources: [] as unknown[],
	preview: vi.fn(),
}));

vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({ data: { harnesses: [] } }),
	useHarnessSettings: () => ({ data: { canEditRuntime: true } }),
}));

vi.mock("@/lib/api/hooks/use-agent-setup-orpc", () => {
	const change = () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
	return {
		useSharedSet: () => ({ data: live.set, isError: false }),
		useSharedSources: () => ({ data: live.sources }),
		usePreviewSharedServer: () => ({ ...change(), mutate: live.preview }),
		useApproveSharedServer: change,
		useRemoveSharedServer: change,
		useRevealSharedServerRow: change,
		useSetSharedMembership: change,
		useUpdateSharedSet: change,
	};
});

vi.mock("@/components/ui/select", async () => {
	const R = await import("react");
	const Ctx = R.createContext<{
		value?: string;
		onValueChange?: (v: string) => void;
	}>({});
	return {
		Select: ({
			value,
			onValueChange,
			children,
		}: {
			value?: string;
			onValueChange?: (v: string) => void;
			children: React.ReactNode;
		}) => (
			<Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
		),
		SelectTrigger: () => null,
		SelectValue: () => null,
		SelectContent: ({ children }: { children: React.ReactNode }) => (
			<div data-testid="stub-select">{children}</div>
		),
		SelectItem: ({
			value,
			children,
		}: {
			value: string;
			children: React.ReactNode;
		}) => {
			const c = R.useContext(Ctx);
			return (
				<button
					type="button"
					aria-pressed={c.value === value}
					data-testid={`stub-option-${value}`}
					onClick={() => c.onValueChange?.(value)}
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

const AGENTS = [
	{ id: "claude-code", label: "Claude Code" },
	{ id: "codex", label: "Codex" },
];
const labelOf = (id: string) => AGENTS.find((a) => a.id === id)?.label ?? id;

const stdioSource: SharedSource = {
	agent: "codex",
	path: "~/.codex/config.toml",
	key: "Docs Search",
};
const stdioPreview: SharedServerPreview = {
	source: stdioSource,
	transport: "stdio",
	command: "/usr/bin/node",
	args: [null, null],
	origin: null,
	hasPath: false,
	removed: [],
	env: ["DOCS_TOKEN"],
	headers: [],
	revision: "rev-docs",
};
const httpSource: SharedSource = {
	agent: "claude-code",
	path: "~/.claude.json",
	key: "tickets",
};
const httpPreview: SharedServerPreview = {
	source: httpSource,
	transport: "http",
	command: null,
	args: [],
	origin: "https://mcp.example.com",
	hasPath: true,
	removed: ["sign-in", "query"],
	env: [],
	headers: ["Authorization"],
	revision: "rev-tickets",
};
const REVEALED: Record<string, string> = {
	"0": "server.js",
	"1": "--key=abc",
	path: "/v1/mcp",
};

const onPick = vi.fn();
const onReveal = vi.fn(async (row: number | "path") => REVEALED[String(row)]);
const onApprove = vi.fn();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	onPick.mockClear();
	onReveal.mockClear();
	onApprove.mockClear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const byId = (id: string) =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => byId(id)?.textContent ?? null;
const click = async (id: string) => {
	await act(async () => byId(id)?.click());
};
const type = async (id: string, value: string) => {
	const el = byId(id) as HTMLInputElement;
	const set = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		set?.call(el, value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
};
const approveDisabled = () =>
	(byId("share-approve") as HTMLButtonElement).disabled;

const renderForm = async (
	source: SharedSource,
	preview: SharedServerPreview,
) => {
	await act(async () =>
		root.render(
			<ShareServerForm
				sources={[
					{ ...stdioSource, transport: "stdio" },
					{ ...httpSource, transport: "http" },
				]}
				agents={AGENTS}
				labelOf={labelOf}
				initial={source}
				preview={preview}
				previewing={false}
				onPick={onPick}
				onReveal={onReveal}
				onApprove={onApprove}
				pending={false}
				error={null}
			/>,
		),
	);
};

describe("ShareServerForm", () => {
	it("shows every argument as dots until that row's Reveal, and Confirm waits for it", async () => {
		await renderForm(stdioSource, stdioPreview);
		expect(onPick).toHaveBeenCalledWith(stdioSource);
		expect(text("share-arg-0-value")).toBe("••••••");
		expect(text("share-arg-1-value")).toBe("••••••");
		expect((byId("share-arg-0-confirm") as HTMLButtonElement).disabled).toBe(
			true,
		);
		await click("share-arg-0-reveal");
		expect(onReveal).toHaveBeenCalledTimes(1);
		expect(onReveal).toHaveBeenCalledWith(0);
		expect(text("share-arg-0-value")).toBe("server.js");
		expect(text("share-arg-1-value")).toBe("••••••");
		expect((byId("share-arg-0-confirm") as HTMLButtonElement).disabled).toBe(
			false,
		);
	});

	it("keeps Approve disabled until every argument is confirmed or typed as Secret, then approves exactly what was shown", async () => {
		await renderForm(stdioSource, stdioPreview);
		expect(approveDisabled()).toBe(true);
		await click("share-arg-0-reveal");
		await click("share-arg-1-secret");
		await type("share-arg-1-secret-input", "s3cret");
		// Revealed but not confirmed: still not approvable.
		expect(approveDisabled()).toBe(true);
		await type("share-arg-1-secret-input", "");
		await click("share-arg-0-confirm");
		expect(approveDisabled()).toBe(true);
		expect(approveDisabled()).toBe(true);
		await type("share-arg-1-secret-input", "s3cret");
		expect(approveDisabled()).toBe(false);
		await click("share-approve");
		expect(onApprove).toHaveBeenCalledTimes(1);
		expect(onApprove).toHaveBeenCalledWith({
			name: "docs-search",
			def: {
				type: "stdio",
				command: "/usr/bin/node",
				args: ["server.js", { value: "ARG_2" }],
				env: ["DOCS_TOKEN"],
			},
			values: { ARG_2: "s3cret" },
			recipients: ["claude-code", "codex"],
			from: { ...stdioSource, revision: "rev-docs" },
		});
		expect(text("share-form")).toContain(
			"Starts in each thread's folder and may read config there.",
		);
		expect(text("share-form")).toContain(
			"Shared as shown to every agent you pick.",
		);
	});

	it("names what parsing took off the URL and approves only once the revealed path is confirmed", async () => {
		await renderForm(httpSource, httpPreview);
		expect(text("share-removed")).toBe("Removed from the URL: sign-in, query");
		expect(text("share-path-value")).toBe("••••••");
		expect(byId("share-path-secret")).toBeNull();
		expect(approveDisabled()).toBe(true);
		await click("share-path-reveal");
		expect(onReveal).toHaveBeenCalledWith("path");
		expect(approveDisabled()).toBe(true);
		await click("share-path-confirm");
		await click("share-recipient-codex");
		expect(approveDisabled()).toBe(false);
		await click("share-approve");
		expect(onApprove).toHaveBeenCalledWith({
			name: "tickets",
			def: {
				type: "http",
				url: "https://mcp.example.com/v1/mcp",
				query: [],
				headers: ["Authorization"],
			},
			values: {},
			recipients: ["claude-code"],
			from: { ...httpSource, revision: "rev-tickets" },
		});
		expect(text("share-form")).not.toContain("Starts in each thread's folder");
	});

	it("names a secret argument's value apart from an env var the source already calls ARG_1", async () => {
		await renderForm(stdioSource, {
			...stdioPreview,
			args: [null],
			env: ["ARG_1"],
		});
		const envInput = container.querySelector<HTMLInputElement>(
			'[data-testid="share-value-ARG_1"] input',
		);
		const set = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		await act(async () => {
			set?.call(envInput, "env-value");
			envInput?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await click("share-arg-0-secret");
		await type("share-arg-0-secret-input", "arg-value");
		await click("share-approve");
		expect(onApprove).toHaveBeenCalledWith({
			name: "docs-search",
			def: {
				type: "stdio",
				command: "/usr/bin/node",
				args: [{ value: "ARG_2" }],
				env: ["ARG_1"],
			},
			values: { ARG_1: "env-value", ARG_2: "arg-value" },
			recipients: ["claude-code", "codex"],
			from: { ...stdioSource, revision: "rev-docs" },
		});
	});
});

const server = (over: Partial<SharedMcpServerView>): SharedMcpServerView => ({
	name: "docs",
	transport: "stdio",
	command: "node",
	argCount: 2,
	host: null,
	valueNames: [],
	missingValues: [],
	recipients: ["claude-code"],
	changedInSource: false,
	fromAgent: null,
	fromSource: null,
	...over,
});

describe("SharedSetView", () => {
	const set: SharedSet = {
		decided: "shared",
		instructions: "Prefer read-only commands.",
		instructionsFor: ["claude-code"],
		revision: "r1",
		servers: [
			server({ missingValues: ["DOCS_TOKEN"], valueNames: ["DOCS_TOKEN"] }),
			server({
				name: "tickets",
				transport: "http",
				command: null,
				argCount: 0,
				host: "mcp.example.com",
				recipients: ["claude-code", "codex"],
				changedInSource: true,
				fromAgent: "codex",
				fromSource: {
					agent: "codex",
					path: "~/.codex/config.toml",
					key: "knowledge",
				},
			}),
		],
	};
	const onCopyAgain = vi.fn();
	const onMember = vi.fn();
	const renderView = (
		onSaveInstructions: (text: string) => Promise<unknown> = async () =>
			undefined,
		saveError: unknown = null,
	) =>
		act(async () =>
			root.render(
				<SharedSetView
					set={set}
					agents={[...AGENTS, { id: "gemini", label: "Gemini CLI" }]}
					labelOf={labelOf}
					canEdit
					saving={false}
					onSaveInstructions={onSaveInstructions}
					saveError={saveError}
					onShare={vi.fn()}
					onCopyAgain={onCopyAgain}
					onRemove={vi.fn()}
					onMember={onMember}
				/>,
			),
		);

	it("lists each server's transport, command and argument count or host, its recipients, Needs values and Changed in its agent with Copy again", async () => {
		await renderView();
		const docs = byId("shared-server-docs");
		const tickets = byId("shared-server-tickets");
		const inRow = (row: HTMLElement | null, id: string) =>
			row?.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
		expect(inRow(docs, "shared-server-line")).toBe(
			"stdio · node · 2 arguments",
		);
		expect(inRow(docs, "shared-server-recipients")).toBe("To Claude Code");
		expect(inRow(docs, "shared-server-needs-values")).toBe("Needs values");
		expect(inRow(docs, "shared-server-changed")).toBeNull();
		expect(inRow(tickets, "shared-server-line")).toBe("http · mcp.example.com");
		expect(inRow(tickets, "shared-server-recipients")).toBe(
			"To Claude Code, Codex",
		);
		expect(inRow(tickets, "shared-server-needs-values")).toBeNull();
		expect(inRow(tickets, "shared-server-changed")).toBe("Changed in Codex");
		await act(async () =>
			tickets
				?.querySelector<HTMLElement>('[data-testid="shared-server-copy-again"]')
				?.click(),
		);
		// The entry it was copied from, whatever name it was shared under.
		expect(onCopyAgain.mock.calls[0]?.[0]?.fromSource).toEqual({
			agent: "codex",
			path: "~/.codex/config.toml",
			key: "knowledge",
		});
	});

	it("keeps the typed instructions when saving fails, and shows why", async () => {
		const save = vi.fn(async () => {
			throw new Error("Save failed");
		});
		await renderView(save, new Error("Save failed"));
		const area = byId("shared-set-instructions-input") as HTMLTextAreaElement;
		const set = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set;
		await act(async () => {
			set?.call(area, "Cite the runbook.");
			area.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await click("shared-set-instructions-save");
		expect([
			save.mock.calls,
			(byId("shared-set-instructions-input") as HTMLTextAreaElement).value,
			text("shared-set-instructions-error"),
		]).toEqual([[["Cite the runbook."]], "Cite the runbook.", "Save failed"]);
	});

	it("shows the instructions hint and the saved text", async () => {
		await renderView();
		expect(
			byId("shared-set-instructions")?.textContent?.startsWith(
				"InstructionsSent to agents and kept with each thread.",
			),
		).toBe(true);
		expect(
			(byId("shared-set-instructions-input") as HTMLTextAreaElement).value,
		).toBe("Prefer read-only commands.");
	});

	it("shows an agent that is in no server or the instructions unticked, and its switch adds it", async () => {
		await renderView();
		expect(
			byId("shared-set-agent-claude-code-switch")?.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			byId("shared-set-agent-gemini-switch")?.getAttribute("aria-checked"),
		).toBe("false");
		await click("shared-set-agent-gemini-switch");
		expect(onMember).toHaveBeenCalledWith("gemini", true);
	});
});

describe("SharedSetSettings Copy again", () => {
	const older = {
		agent: "codex",
		path: "~/.codex/config.toml",
		key: "tickets",
		transport: "http",
	};
	const copied = { ...older, path: "~/work/.codex/config.toml" };
	const copyAgain = async (from: SharedSource | null) => {
		live.preview.mockClear();
		live.sources = [older, copied];
		live.set = {
			decided: "shared",
			instructions: "",
			instructionsFor: [],
			revision: "r1",
			servers: [
				server({
					name: "tickets",
					changedInSource: true,
					fromAgent: "codex",
					fromSource: from,
				}),
			],
		} satisfies SharedSet;
		await act(async () => root.render(<SharedSetSettings />));
		await click("shared-server-copy-again");
	};

	it("opens the source whose path and key the server was copied from, among two of one agent and name", async () => {
		await copyAgain({ agent: "codex", path: copied.path, key: copied.key });
		expect(live.preview.mock.calls).toEqual([[copied]]);
	});

	it("opens no source when the copied entry is gone", async () => {
		await copyAgain({ agent: "codex", path: "~/gone.toml", key: "tickets" });
		expect(live.preview.mock.calls).toEqual([]);
	});

	it("opens the agent's source of the same name when the server records no entry", async () => {
		await copyAgain(null);
		expect(live.preview.mock.calls).toEqual([[older]]);
	});
});
