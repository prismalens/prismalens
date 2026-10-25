// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import type { AcpRegistryEntry } from "@prismalens/config/acp-registry";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcpRegistrySearch, searchRegistry } from "./AcpRegistrySearch";
import { agentEnvVarNames, EnvVarNotes, envStateWord } from "./agent-env";
import { StepList } from "./SourceConnectDialog";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("searchRegistry and AcpRegistrySearch (#848)", () => {
	let container: HTMLDivElement | null = null;
	let root: ReturnType<typeof createRoot> | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		if (container) {
			act(() => root?.unmount());
			container.remove();
			container = null;
			root = null;
		}
	});

	const dummyEntries: AcpRegistryEntry[] = [
		{
			id: "code-buddy",
			name: "Code Buddy",
			description: "An agent that helps with code",
			install: ["npm i -g code-buddy", "code-buddy setup"],
		},
		{
			id: "python-helper",
			name: "Python Helper",
			description: "Helps write python code and tests",
			install: ["pip install python-helper"],
		},
		{
			id: "other-agent",
			name: "Other Agent",
			description: "Does something else",
			install: ["curl -sSL https://agent.sh | bash"],
		},
	];

	it("filters registry entries by all query words and limits to 8, returning empty for blank query", () => {
		expect(searchRegistry("", dummyEntries)).toEqual([]);
		expect(searchRegistry("   ", dummyEntries)).toEqual([]);

		const codeMatches = searchRegistry("code", dummyEntries);
		expect(codeMatches.map((e) => e.id)).toEqual([
			"code-buddy",
			"python-helper",
		]);

		const multiWordMatches = searchRegistry("python code", dummyEntries);
		expect(multiWordMatches.map((e) => e.id)).toEqual(["python-helper"]);

		const tenEntries: AcpRegistryEntry[] = Array.from(
			{ length: 10 },
			(_, i) => ({
				id: `agent-${i}`,
				name: `Agent ${i}`,
				description: "code agent",
				install: [],
			}),
		);
		expect(searchRegistry("code", tenEntries)).toHaveLength(8);
	});

	it("renders AcpRegistrySearch and shows entry install lines on click", async () => {
		await act(async () => {
			root?.render(<AcpRegistrySearch entries={dummyEntries} />);
		});

		const input = container?.querySelector(
			'[data-testid="acp-registry-search"]',
		) as HTMLInputElement | null;
		expect(input).not.toBeNull();

		if (input) {
			await act(async () => {
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(input, "code");
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			});
		}

		const entries = container?.querySelectorAll(
			'[data-testid="acp-registry-entry"]',
		);
		expect(entries?.length).toBe(2);
		expect(entries?.[0]?.textContent).toContain("Not installed");

		const firstEntryBtn = entries?.[0] as HTMLButtonElement | undefined;
		if (firstEntryBtn) {
			await act(async () => {
				firstEntryBtn.click();
			});
		}

		const chips = container?.querySelectorAll(
			'[data-testid="acp-registry-install"]',
		);
		expect(chips?.length).toBe(2);
		expect(chips?.[0]?.textContent).toContain("npm i -g code-buddy");
	});
});

describe("StepList (#848)", () => {
	let container: HTMLDivElement | null = null;
	let root: ReturnType<typeof createRoot> | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		if (container) {
			act(() => root?.unmount());
			container.remove();
			container = null;
			root = null;
		}
	});

	it("ticks finished steps before current and sets aria-current on the current step", async () => {
		const steps = ["Source type", "Credentials", "Verify"];
		await act(async () => {
			root?.render(<StepList steps={steps} current={1} />);
		});

		const items = container?.querySelectorAll("li");
		expect(items?.length).toBe(3);

		expect(items?.[0]?.hasAttribute("data-done")).toBe(true);
		expect(items?.[0]?.getAttribute("aria-current")).toBeNull();
		expect(items?.[0]?.querySelector("svg")).not.toBeNull();

		expect(items?.[1]?.hasAttribute("data-done")).toBe(false);
		expect(items?.[1]?.getAttribute("aria-current")).toBe("step");

		expect(items?.[2]?.hasAttribute("data-done")).toBe(false);
		expect(items?.[2]?.getAttribute("aria-current")).toBeNull();
	});
});

describe("agent-env (#848)", () => {
	let container: HTMLDivElement | null = null;
	let root: ReturnType<typeof createRoot> | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		if (container) {
			act(() => root?.unmount());
			container.remove();
			container = null;
			root = null;
		}
	});

	it("returns provider keys and custom model option for an agent", () => {
		const vars = agentEnvVarNames("claude-code");
		expect(vars).toContain("ANTHROPIC_API_KEY");
		expect(vars).toContain("ANTHROPIC_CUSTOM_MODEL_OPTION");
		expect(vars[vars.length - 1]).toBe("ANTHROPIC_CUSTOM_MODEL_OPTION");
	});

	it("maps envStateWord correctly", () => {
		expect(envStateWord("set")).toBe("Key set");
		expect(envStateWord("env")).toBe("From environment");
		expect(envStateWord("unset")).toBe("Not set");
	});

	it("renders EnvVarNotes for set state with override note and signin warning", async () => {
		await act(async () => {
			root?.render(
				<EnvVarNotes
					agent="Claude Code"
					id="claude-code"
					name="ANTHROPIC_API_KEY"
					state="set"
					inEnv={true}
				/>,
			);
		});

		const overrides = container?.querySelector('[data-testid="env-overrides"]');
		expect(overrides).not.toBeNull();
		expect(overrides?.textContent).toBe("Overrides the environment");

		const warning = container?.querySelector(
			'[data-testid="env-signin-warning"]',
		);
		expect(warning).not.toBeNull();
		expect(warning?.textContent).toContain(
			"If Claude Code is signed in, it may use this key instead.",
		);
	});

	it("renders nothing for env or unset state", async () => {
		await act(async () => {
			root?.render(
				<EnvVarNotes
					agent="Claude Code"
					id="claude-code"
					name="ANTHROPIC_API_KEY"
					state="env"
					inEnv={true}
				/>,
			);
		});
		expect(container?.innerHTML).toBe("");

		await act(async () => {
			root?.render(
				<EnvVarNotes
					agent="Claude Code"
					id="claude-code"
					name="ANTHROPIC_API_KEY"
					state="unset"
				/>,
			);
		});
		expect(container?.innerHTML).toBe("");
	});
});
