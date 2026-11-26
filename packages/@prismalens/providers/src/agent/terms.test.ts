// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { SignInMethod } from "../descriptor.ts";
import { agents } from "../agents.ts";
import { authPathOf, runsUnder, termsGate } from "./terms.ts";

const agent = (id: string) => {
	const a = agents().find((x) => x.id === `agent.${id}`);
	if (!a) throw new Error(`no agent ${id}`);
	return a;
};
const pathOf = (id: string, env: Record<string, string>, sent?: string) =>
	authPathOf(agent(id).auth, env, sent)?.method.id;

const QWEN_BOTS =
	'its terms say "Modifying, copying, leasing, selling, distributing, or manipulating our Service; using bots to access the Service." (https://qwen.ai/termsservice).';
const CODING_PLAN =
	'its terms say "Do not use the plan\'s API key for automated scripts, application backends, or other non-interactive scenarios." (https://www.alibabacloud.com/help/en/model-studio/coding-plan).';

describe("runsUnder", () => {
	it("lets every starter use an allowed or unknown path, only a person an interactive-only one, and nobody a never one", () => {
		const table = (["allowed", "unknown", "interactive-only", "never"] as const).map(
			(runs) => [runs, runsUnder(runs, "person"), runsUnder(runs, "alert"), runsUnder(runs, "schedule")],
		);
		expect(table).toEqual([
			["allowed", true, true, true],
			["unknown", true, true, true],
			["interactive-only", true, false, false],
			["never", false, false, false],
		]);
	});
});

describe("authPathOf", () => {
	it("takes the method the run sends over ACP: Antigravity with GEMINI_API_KEY set and a Google sign-in cached runs on the key", () => {
		expect(pathOf("antigravity", { GEMINI_API_KEY: "AIza-k" }, "gemini-api-key")).toBe("api-key");
		expect(pathOf("antigravity", {}, "oauth-personal")).toBe("login");
	});

	it("reads a Coding Plan key by its sk-sp- prefix or base URL, ahead of the method the run sends", () => {
		expect(pathOf("qwen", { OPENAI_API_KEY: "sk-sp-abc" }, "openai")).toBe("coding-plan");
		expect(
			pathOf("claude-code", {
				ANTHROPIC_AUTH_TOKEN: "t",
				ANTHROPIC_BASE_URL: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
			}),
		).toBe("coding-plan");
		expect(pathOf("qwen", { OPENAI_API_KEY: "sk-abc" }, "openai")).toBe("api-key");
	});

	it("takes the env key where the CLI's docs say env wins, else the stored sign-in when none is set", () => {
		expect(pathOf("claude-code", { ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("api-key");
		expect(pathOf("claude-code", {})).toBe("login");
		expect(pathOf("qwen", {})).toBe("login");
	});

	it("holds a run to the stricter verdict when both may apply and the CLI does not document env as winning", () => {
		const methods: SignInMethod[] = [
			{ id: "login", label: "Acme account", steps: ["browser"], terms: { runs: "interactive-only", source: { url: "https://acme.test/terms", clause: "No bots.", readOn: "2026-11-26" } } },
			{ id: "api-key", label: "ACME_KEY", steps: ["credentials"], env: [{ name: "ACME_KEY" }], terms: { runs: "allowed", source: { url: "https://acme.test/api", clause: "Keys are for programs.", readOn: "2026-11-26" } } },
		];
		const path = authPathOf({ methods }, { ACME_KEY: "k" });
		expect({ method: path?.method.id, other: path?.other?.id }).toEqual({ method: "login", other: "api-key" });
		expect(termsGate({ name: "Acme", auth: { methods } }, { ACME_KEY: "k" }, "alert")).toEqual({
			refuse:
				'Alert and scheduled runs can\'t use Acme on Acme account: its terms say "No bots." (https://acme.test/terms). Acme may use Acme account even with ACME_KEY set, and its docs don\'t say which wins, so the stricter terms hold. Start it yourself, or sign out of Acme\'s own sign-in and use ACME_KEY.',
		});
	});

	it("lets a key with an ACP method win over a stricter stored sign-in only when the run sends that method", () => {
		const methods: SignInMethod[] = [
			{ id: "login", label: "Acme account", steps: ["browser"], terms: { runs: "interactive-only", source: { url: "https://acme.test/terms", clause: "No bots.", readOn: "2026-11-26" } } },
			{ id: "api-key", label: "ACME_KEY", steps: ["credentials"], env: [{ name: "ACME_KEY" }], acp: "acme-key", terms: { runs: "allowed", source: { url: "https://acme.test/api", clause: "Keys are for programs.", readOn: "2026-11-26" } } },
		];
		const path = (sent?: string) => {
			const p = authPathOf({ methods }, { ACME_KEY: "k" }, sent);
			return [p?.method.id, p?.other?.id];
		};
		expect([path(), path("oauth"), path("acme-key")]).toEqual([
			["login", "api-key"],
			["login", "api-key"],
			["api-key", undefined],
		]);
	});

	it("counts goose's Coding Plan key only when GOOSE_PROVIDER is unset or picks the provider that reads it", () => {
		expect([
			pathOf("goose", { GOOSE_PROVIDER: "ollama", ANTHROPIC_API_KEY: "sk-sp-1" }),
			pathOf("goose", { GOOSE_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-sp-1" }),
			pathOf("goose", { GOOSE_PROVIDER: "openai", OPENAI_API_KEY: "sk-sp-1" }),
			pathOf("goose", { ANTHROPIC_API_KEY: "sk-sp-1" }),
		]).toEqual(["api-key", "coding-plan", "coding-plan", "coding-plan"]);
	});
});

describe("termsGate", () => {
	it("refuses an alert run on Qwen's own sign-in with the clause, and names the key that would run it", () => {
		expect(termsGate(agent("qwen"), {}, "alert")).toEqual({
			refuse: `Alert and scheduled runs can't use Qwen Code on Qwen account: ${QWEN_BOTS} Start it yourself, or use OPENAI_API_KEY, OPENAI_MODEL and OPENAI_BASE_URL instead.`,
		});
		expect(termsGate(agent("qwen"), {}, "person")).toBeNull();
	});

	it("refuses a scheduled Claude Code run on a Coding Plan key and names each plan setting to replace or clear", () => {
		const lead = `Alert and scheduled runs can't use Claude Code on Alibaba Coding Plan key (sk-sp-): ${CODING_PLAN} Start it yourself, or`;
		expect([
			termsGate(agent("claude-code"), { ANTHROPIC_AUTH_TOKEN: "sk-sp-1" }, "schedule"),
			termsGate(
				agent("claude-code"),
				{ ANTHROPIC_API_KEY: "sk-sp-2", ANTHROPIC_BASE_URL: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic" },
				"alert",
			),
		]).toEqual([
			{ refuse: `${lead} replace the plan key in ANTHROPIC_AUTH_TOKEN with a key from outside the plan.` },
			{ refuse: `${lead} replace the plan key in ANTHROPIC_API_KEY with a key from outside the plan, and clear ANTHROPIC_BASE_URL.` },
		]);
	});

	it("passes alert runs on every allowed path: Grok's own sign-in, Antigravity's Google sign-in, a Claude subscription", () => {
		expect([
			termsGate(agent("grok"), {}, "alert", "grok.com"),
			termsGate(agent("antigravity"), {}, "alert", "oauth-personal"),
			termsGate(agent("claude-code"), {}, "schedule"),
		]).toEqual([null, null, null]);
	});

	it("refuses every run on a never path and lets every run use an unknown one", () => {
		const never: SignInMethod = { id: "login", label: "Acme account", steps: ["browser"], terms: { runs: "never", source: { url: "https://acme.test/terms", clause: "You must not run it in other apps.", readOn: "2026-11-26" } } };
		const unknown: SignInMethod = { ...never, terms: { runs: "unknown", source: never.terms.source, gaps: ["acme.test/aup: needs JavaScript"] } };
		const starters = ["person", "alert", "schedule"] as const;
		const refused = {
			refuse: 'PrismaLens doesn\'t run Acme on Acme account: its terms say "You must not run it in other apps." (https://acme.test/terms).',
		};
		expect(starters.map((s) => termsGate({ name: "Acme", auth: { methods: [never] } }, {}, s))).toEqual([refused, refused, refused]);
		expect(starters.map((s) => termsGate({ name: "Acme", auth: { methods: [unknown] } }, {}, s))).toEqual([null, null, null]);
	});
});
