// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AskState } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { askLinkText } from "./AskLinkNotice";

const ask = (state: AskState["state"], outcome: string | null = null): AskState => ({
	state,
	outcome,
	title: "kubectl rollout restart",
	incidentId: "i1",
});

describe("askLinkText (#859): a stale link says where its own ask stands", () => {
	it.each([
		[ask("answered", "approved"), "Answered on another device: approved."],
		[ask("timed_out"), "timed out"],
		[ask("run_ended"), "The run ended before anyone answered"],
		[ask("needed_approval"), 'needed approval for "kubectl rollout restart"'],
		[ask("waiting"), "waiting on you"],
		[ask("unknown"), "does not have"],
	])("%#", (state, text) => {
		expect(askLinkText(state)).toContain(text);
	});
});
