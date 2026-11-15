// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const oneFactOnePlace = define.lens({
	id: "screen.one-fact",
	group: "product",
	said: {
		date: "2026-11-15",
		quote:
			"we somehow need a way to know when multiple surfaces are shown on a screen then how many of them show duplicate info. That just clutters up the UI.",
		where:
			"operator, #1101 - Wave 2: thread UX hill climb, round 2, Operator review 2026-11-15",
	},
	conditions: ["net.slow-link"],
	check: {
		script: "scripts/sim/judge-evidence.mjs",
		measure:
			"facts (registry/closed/fact.ts) about one thread shown in more than one place on an evidence screen, less the declared repeats",
		budget: "the measure/facts row in registry.ratchet.tsv, which only falls",
	},
	surfaces: [
		"thread.row",
		"thread.header",
		"thread.details",
		"incident.header",
		"needs.card",
		"pr.chip",
		"git.state",
	],
	simulator: "pw.judge-evidence",
	ci: { case: "packages/frontend/scripts/check-ui-budget.mjs" },
	rubric:
		"Each fact (agent, model, host, status, cause, a time) shows in one region of a screen, the one where it lives best. A second showing is declared in the fact's entry with its reason, or removed. The transcript's own words never move.",
	status: "active",
});
