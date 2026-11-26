// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { pickerBlock } from "@/components/agent/agent-choice";
import { SignInPaths } from "./SignInPaths";

const qwen = (authPath: HarnessStatus["authPath"]): HarnessStatus => ({
	id: "qwen",
	label: "Qwen Code",
	binary: "qwen",
	installed: true,
	runnable: true,
	tested: null,
	install: "",
	defaultModel: null,
	localDefault: { permission: null },
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
	cliBinary: "",
	configDir: null,
	providerKeys: [],
	envVars: [],
	models: { source: "harness", asOf: "", entries: [] },
	checked: null,
	authPath,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
	act(() => root?.unmount());
	host?.remove();
});

function render(status: HarnessStatus) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	act(() => root?.render(<SignInPaths agent={status} />));
	const text = (id: string) =>
		host?.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
	return { text };
}

describe("SignInPaths (#1252)", () => {
	it("gives each of Qwen Code's sign-ins its verdict and clause, and marks the one runs use here", () => {
		const { text } = render(qwen({ method: "api-key", runs: "allowed" }));
		expect([
			text("agent-sign-in-login-runs"),
			text("agent-sign-in-coding-plan-runs"),
			text("agent-sign-in-api-key-runs"),
		]).toEqual(["Your runs only", "Your runs only", "Alerts and schedules"]);
		expect(text("agent-sign-in-api-key")).toContain("Runs use this one here.");
		expect(text("agent-sign-in-login")).toContain(
			"“Modifying, copying, leasing, selling, distributing, or manipulating our Service; using bots to access the Service.” qwen.ai, read 2026-11-26. Not read: qwen.ai/termsservice renders only with JavaScript: read from its bundle g.alicdn.com/qwenweb/qwen-ai-fe/0.0.91/js/9253.js, no browser read.",
		);
	});
});

describe("pickerBlock (#1252)", () => {
	it("names the clause when the path runs use here is never, and blocks nothing otherwise", () => {
		expect([
			pickerBlock(qwen({ method: "login", runs: "never" })),
			pickerBlock(qwen({ method: "login", runs: "interactive-only" })),
			pickerBlock(qwen(null)),
		]).toEqual([
			'PrismaLens doesn\'t run Qwen Code on Qwen account: "Modifying, copying, leasing, selling, distributing, or manipulating our Service; using bots to access the Service."',
			null,
			null,
		]);
	});
});
