// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddAgentDialog, tileState } from "./AddAgentDialog";

const mutateAsync = vi.fn();
const checkAsync = vi.fn();
const navigate = vi.fn();
let settings: Record<string, unknown> = {};

const status = (over: Partial<HarnessStatus>): HarnessStatus => ({
	id: "codex",
	label: "Codex",
	binary: "codex-acp",
	installed: true,
	runnable: true,
	tested: null,
	install: "npm i -g @openai/codex",
	defaultModel: null,
	localDefault: { permission: null },
	modelVia: "acp",
	loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
	envModel: null,
	windowsOnlyPath: null,
	cliBinary: "codex",
	configDir: { envKey: "CODEX_HOME", shownDefault: "~/.codex" },
	providerKeys: ["CODEX_API_KEY", "OPENAI_API_KEY"],
	models: { source: "harness", asOf: "", entries: [] },
	checked: null,
	...over,
});

const checked = (
	outcome: NonNullable<HarnessStatus["checked"]>["outcome"],
	detail: string,
) => ({
	at: "",
	outcome,
	detail,
	version: null,
	companionVersion: null,
	servedModel: null,
	effort: null,
	modes: null,
	efforts: null,
	images: false,
	sandbox: null,
});

const harnesses: HarnessStatus[] = [
	status({
		id: "claude-code",
		label: "Claude Code",
		checked: checked("answers-acp", "answers ACP"),
	}),
	status({
		id: "codex",
		label: "Codex",
		runnable: false,
		checked: checked("sign-in-needed", "sign in needed"),
	}),
	status({
		id: "opencode",
		label: "OpenCode",
		installed: false,
		runnable: false,
	}),
	status({
		id: "deepagents",
		label: "deepagents",
		runnable: false,
		checked: checked("failed-to-start", "failed to start"),
	}),
	status({
		id: "gemini",
		label: "Gemini CLI",
		installed: false,
		runnable: false,
		windowsOnlyPath: "/mnt/c/x/gemini",
	}),
	status({
		id: "local",
		label: "Local agent",
		installed: false,
		runnable: false,
		cliBinary: "",
		configDir: null,
	}),
];

vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({
		data: { harnesses, selection: { harness: "claude-code" } },
		isLoading: false,
	}),
	useHarnessSettings: () => ({ data: settings, isLoading: false }),
	useUpdateHarnessSettings: () => ({
		mutate: vi.fn(),
		mutateAsync,
		isPending: false,
		error: null,
	}),
	useCheckHarness: () => ({
		mutate: vi.fn(),
		mutateAsync: checkAsync,
		isPending: false,
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	Link: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ isMutating: () => 0 }),
}));
vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => ({
		customModels: {},
		hiddenModels: {},
		modelOrder: {},
		favourites: [],
	}),
	modelName: (_h: unknown, id: string) => id,
}));

const domStubs: Record<string, () => unknown> = {
	hasPointerCapture: () => false,
	setPointerCapture: () => undefined,
	releasePointerCapture: () => undefined,
	scrollIntoView: () => undefined,
};
for (const [k, v] of Object.entries(domStubs)) {
	if (!(k in Element.prototype)) Object.assign(Element.prototype, { [k]: v });
}
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const q = (id: string) =>
	document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (id: string) => {
	await act(async () => q(id)?.click());
};
const typeInto = async (id: string, value: string) => {
	await act(async () => {
		const input = q(id) as HTMLInputElement;
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
};

beforeEach(async () => {
	settings = { harness: "auto" };
	mutateAsync.mockReset().mockResolvedValue({});
	checkAsync.mockReset();
	navigate.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	document.body.innerHTML = "";
});
const render = async () => {
	await act(async () =>
		root.render(<AddAgentDialog open onOpenChange={vi.fn()} />),
	);
};

describe("Add agent tiles (#907)", () => {
	it("names each supported agent's state in a neutral word, plus Local ACP command", async () => {
		await render();
		expect(q("add-agent-tile-claude-code-state")?.textContent).toBe("Ready");
		expect(q("add-agent-tile-codex-state")?.textContent).toBe("Sign-in needed");
		expect(q("add-agent-tile-opencode-state")?.textContent).toBe(
			"Not installed",
		);
		expect(q("add-agent-tile-deepagents-state")?.textContent).toBe(
			"Not responding",
		);
		expect(q("add-agent-tile-gemini-state")?.textContent).toBe(
			"Windows install, can't run in WSL",
		);
		expect(q("add-agent-tile-local")?.textContent).toContain(
			"Local ACP command",
		);
		expect(tileState(status({ checked: null }))).toBe("Ready");
	});

	it("opens a ready agent's page at once", async () => {
		await render();
		await click("add-agent-tile-claude-code");
		expect(navigate).toHaveBeenCalledWith({
			to: "/settings",
			search: { tab: "harness", agent: "claude-code" },
		});
	});
});

describe("Add agent steps (#907)", () => {
	it("walks a signed-out agent through its sign-in command, its key, and Check and add", async () => {
		checkAsync.mockResolvedValue({
			outcome: "sign-in-needed",
			detail: "sign in needed",
		});
		await render();
		await click("add-agent-tile-codex");
		await click("add-agent-next");
		expect(q("add-agent-signin")?.textContent).toContain("codex login");
		expect(q("add-agent-copy")).not.toBeNull();
		await typeInto("add-agent-key", "sk-1");
		await click("add-agent-next");
		expect(mutateAsync).toHaveBeenCalledWith({
			env: { codex: { OPENAI_API_KEY: "sk-1" } },
		});
		expect(q("add-agent-config")).not.toBeNull();
		await click("add-agent-check-and-add");
		expect(checkAsync).toHaveBeenCalledWith({ id: "codex" });
		expect(q("add-agent-result")?.textContent).toContain("sign in needed");
		expect(q("add-agent-close")).not.toBeNull();
	});

	it("offers the install command for an agent that isn't installed, and Next stays on", async () => {
		await render();
		await click("add-agent-tile-opencode");
		await click("add-agent-next");
		expect(q("add-agent-verdict")?.textContent).toContain(
			"Not installed. Install: npm i -g @openai/codex",
		);
		expect((q("add-agent-next") as HTMLButtonElement).disabled).toBe(false);
	});

	it("refuses shell operators in a local command's arguments, and saves it parsed", async () => {
		await render();
		await click("add-agent-tile-local");
		await typeInto("add-agent-command", "/usr/bin/node");
		await typeInto("add-agent-args", "agent.mjs | tee log");
		await click("add-agent-next");
		expect(q("add-agent-error")?.textContent).toBe(
			"Arguments can't hold shell operators.",
		);
		expect(mutateAsync).not.toHaveBeenCalled();
		await typeInto("add-agent-args", 'agent.mjs --name "my agent"');
		await click("add-agent-next");
		expect(mutateAsync).toHaveBeenCalledWith({
			localAgent: {
				command: "/usr/bin/node",
				args: ["agent.mjs", "--name", "my agent"],
			},
		});
	});

	it("reads the Config step only, and hides the key field, on a paired device", async () => {
		settings = { harness: "auto", canEditRuntime: false };
		await render();
		await click("add-agent-tile-codex");
		await click("add-agent-next");
		expect(q("add-agent-api-key")).toBeNull();
		await click("add-agent-next");
		expect((q("runtime-binary-input") as HTMLInputElement).readOnly).toBe(true);
		expect(document.body.textContent).toContain(
			"Only this machine's own session can change what an agent runs.",
		);
	});
});
