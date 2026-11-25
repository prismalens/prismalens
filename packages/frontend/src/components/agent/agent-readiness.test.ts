// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { agentReadiness } from "@/components/home/HomeComposer";
import { agentState } from "@/components/settings/AgentDetail";
import {
	composerGate,
	defaultModel,
	providerState,
	unreadyLine,
	unreadyReason,
} from "./agent-choice";

const base = {
	id: "opencode",
	label: "OpenCode",
	binary: "opencode",
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
	checked: {
		at: "2026-11-24T00:00:00.000Z",
		outcome: "answers-acp",
		detail: "answers ACP",
		version: null,
		companionVersion: null,
		servedModel: "google/gemini-4-neon",
		effort: null,
		modes: null,
		efforts: null,
		images: false,
		sandbox: null,
		providers: ["Ollama Cloud"],
	},
} as HarnessStatus;

const withLogin = (providerSignIn: HarnessStatus["providerSignIn"]) =>
	({ ...base, providerSignIn }) as HarnessStatus;

describe("an agent that answers ACP but holds no login for its model's provider", () => {
	it("reads Sign-in needed in Settings, never Ready", () => {
		expect(agentState(withLogin("signed-out"))).toEqual({
			text: "Sign-in needed",
			tone: "warn",
		});
	});

	it("reads Sign-in not checked when its logins were never read, never Ready", () => {
		expect(agentState(withLogin("unchecked"))).toEqual({
			text: "Sign-in not checked",
			tone: "neutral",
		});
	});

	it("reads Ready only once its login for the model is known", () => {
		expect(agentState(withLogin("signed-in"))).toEqual({
			text: "Ready",
			tone: "ok",
		});
		expect(agentState(withLogin("na"))).toEqual({ text: "Ready", tone: "ok" });
	});

	it("reads the composer's chip and the readiness line from the same login", () => {
		expect(agentReadiness(withLogin("signed-out"))).toBe("signIn");
		expect(agentReadiness(withLogin("unchecked"))).toBe("signIn");
		expect(agentReadiness(withLogin("signed-in"))).toBe("ready");
		expect(unreadyReason(withLogin("signed-out"))).toBe(
			"OpenCode is not signed in to Google. Sign in with its own CLI, then retry.",
		);
		expect(unreadyLine(withLogin("signed-out"))).toBe(
			"OpenCode is not signed in to Google. Sign in with its own CLI, then retry. Check it in Settings, Agent.",
		);
		expect(unreadyReason(withLogin("signed-in"))).toBeNull();
	});

	it("warns the composer on a signed-out or unchecked login, and blocks on a failed check", () => {
		expect(composerGate(withLogin("signed-out"))).toEqual({
			warning:
				"OpenCode is not signed in to Google. Sign in with its own CLI, then retry. Check it in Settings, Agent.",
		});
		expect(composerGate(withLogin("unchecked"))).toEqual({
			warning: "OpenCode: sign-in not checked. Check it in Settings, Agent.",
		});
		expect(composerGate(withLogin("signed-in"))).toEqual({
			warning: undefined,
		});
		expect(composerGate(withLogin("na"))).toEqual({ warning: undefined });
		const failed = {
			...base,
			checked: {
				...base.checked,
				outcome: "failed-to-start",
				detail: "exited 1",
			},
		} as HarnessStatus;
		expect(composerGate(failed)).toEqual({
			blockedReason: "OpenCode: exited 1. Check it in Settings, Agent.",
		});
	});

	it("re-reads the login against a model the picker names instead of the agent's own", () => {
		expect(providerState(base, "ollama-cloud/qwen")).toBe("signed-in");
		expect(providerState(base, "google/gemini-4-neon")).toBe("signed-out");
		expect(unreadyReason(base, "ollama-cloud/qwen")).toBeNull();
	});

	it("reads the composer's chip for the named model, not the status's own word", () => {
		expect(agentReadiness(withLogin("signed-out"), "ollama-cloud/qwen")).toBe(
			"ready",
		);
		expect(
			agentReadiness(withLogin("signed-in"), "google/gemini-4-neon"),
		).toBe("signIn");
	});

	it("reads a folded model id as the agent's own pick, so a signed-out provider is still named", () => {
		const out = withLogin("signed-out");
		expect(providerState(out, "default")).toBe("signed-out");
		expect(unreadyReason(out, "default")).toBe(
			"OpenCode is not signed in to Google. Sign in with its own CLI, then retry.",
		);
	});
});

describe("an agent whose model the check could not name", () => {
	const unnamed = {
		...base,
		providerSignIn: undefined,
		checked: { ...base.checked, servedModel: null, providers: ["Ollama Cloud"] },
	} as HarnessStatus;

	it("reads Sign-in not checked, never Ready, when no model is known", () => {
		expect(providerState(unnamed)).toBe("unchecked");
		expect(agentState(unnamed)).toEqual({
			text: "Sign-in not checked",
			tone: "neutral",
		});
	});

	it("reads from the model a run would take, a signed-in provider's over the agent's own", () => {
		const listed = {
			...unnamed,
			checked: { ...unnamed.checked, servedModel: "google/gemini-4-neon" },
			models: {
				...unnamed.models,
				entries: [
					{ id: "google/gemini-4-neon", name: "Gemini 4 Neon" },
					{ id: "ollama-cloud/qwen", name: "Qwen" },
				],
			},
		} as HarnessStatus;
		expect(defaultModel(listed, null)?.id).toBe("ollama-cloud/qwen");
		expect(defaultModel(listed, "google/gemini-4-neon")?.id).toBe(
			"google/gemini-4-neon",
		);
		expect(agentState(listed)).toEqual({ text: "Ready", tone: "ok" });
	});
});

describe("a status with no sign-in word of its own", () => {
	it("names the provider it checked when the env's model and the served one differ", () => {
		const split = {
			...base,
			providerSignIn: undefined,
			envModel: { model: "google/gemini-4-neon" },
			checked: { ...base.checked, servedModel: "ollama-cloud/qwen" },
		} as HarnessStatus;
		expect(providerState(split)).toBe("signed-out");
		expect(unreadyReason(split)).toBe(
			"OpenCode is not signed in to Google. Sign in with its own CLI, then retry.",
		);
	});
});

describe("an agent that is not on PATH but has a remembered check", () => {
	const gone = {
		...base,
		installed: false,
		checked: { ...base.checked, outcome: "sign-in-needed" },
	} as HarnessStatus;

	it("reads Not installed, never Sign-in needed, in Settings and in the composer", () => {
		expect(agentState(gone)).toEqual({ text: "Not installed", tone: "warn" });
		expect(agentReadiness(gone)).toBe("missing");
		expect(unreadyReason(gone)).toBeNull();
	});
});
