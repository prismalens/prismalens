// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	harnessAuthPath,
	harnessTermsGate,
} from "./harness.js";

describe("sign-in terms against the launch rows (#1252)", () => {
	it("names only env vars its launch row passes to the agent, so a run's env can carry them", () => {
		const unread = HARNESS_IDS.flatMap((id) => {
			const row = HARNESS_REGISTRY[id];
			return row.signIn.methods.flatMap((m) =>
				(m.env ?? [])
					.filter((e) => !row.providerKeys.includes(e.name))
					.map((e) => `${id}.${m.id}: ${e.name}`),
			);
		});
		expect(unread).toEqual([]);
	});

	it("links each method's ACP id to a method its launch row sends", () => {
		const unsent = HARNESS_IDS.flatMap((id) => {
			const row = HARNESS_REGISTRY[id];
			const sends = (row.authenticate ?? []).map((a) => a.methodId);
			return row.signIn.methods
				.filter((m) => m.acp && !sends.includes(m.acp))
				.map((m) => `${id}.${m.id}: ${m.acp}`);
		});
		expect(unsent).toEqual([]);
	});

	it("runs Antigravity on the key when GEMINI_API_KEY is set, because its row then sends gemini-api-key", () => {
		expect([
			harnessAuthPath("antigravity", { GEMINI_API_KEY: "AIza-k" })?.method.id,
			harnessAuthPath("antigravity", {})?.method.id,
		]).toEqual(["api-key", "login"]);
	});

	it("refuses an alert run on Qwen Code's own sign-in in the row's own name, and passes it on a key", () => {
		expect(harnessTermsGate("qwen", {}, "alert")).toEqual({
			refuse:
				'Alert and scheduled runs can\'t use Qwen Code on Qwen account: its terms say "Modifying, copying, leasing, selling, distributing, or manipulating our Service; using bots to access the Service." (https://qwen.ai/termsservice). Start it yourself, or use OPENAI_API_KEY, OPENAI_MODEL and OPENAI_BASE_URL instead.',
		});
		expect(harnessTermsGate("qwen", { OPENAI_API_KEY: "sk-live" }, "alert")).toBeNull();
	});
});
