// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const engSecurity = define.lens({
	id: "eng.security",
	group: "engineering",
	said: {
		date: "2026-11-10",
		quote:
			"I want to do and build a comparable app, we first get a good enough app out and then worry about the small small security details",
		where: "operator, security review triage",
	},
	conditions: [],
	check: {
		script: "scripts/measure/security.mjs",
		measure:
			"simulated attacks failing, high advisories (with dependency-audit.yml) and open findings that are cheap, serious and reachable",
		budget: 0,
	},
	rubric:
		"Fix now only a finding that is reachable without effort, does real harm and has a small fix; every other one goes to the one security backlog issue.",
	status: "active",
});

export const engCiCost = define.lens({
	id: "eng.ci-cost",
	group: "engineering",
	said: {
		date: "2026-11-10",
		quote:
			"do you understand how CI is killing me and why I don't want lanes to keep trying to fix it",
		where:
			"operator, organizer session, 2026-11-10 17:45Z; also 2026-11-11 15:44Z and 15:50Z, recorded-agent CI cases and no real limit hits",
	},
	conditions: [],
	check: {
		script: "scripts/measure/ci-cost.mjs",
		measure:
			"median job minutes per workflow over the last 3 runs, and CI using fake agents only",
		budget: "ratchet rows measure/ci-minutes: they only fall",
	},
	rubric:
		"Per-PR CI runs only the cells the diff touches, nightly runs the rest, and CI spends no real tokens: fake agents only.",
	status: "active",
});

export const engLyingTests = define.lens({
	id: "eng.lying-tests",
	group: "engineering",
	said: {
		date: "2026-11-10",
		quote: "what was the verdict about our tests lying? Are we good there?",
		where: "operator, organizer session, 2026-11-10 09:12Z",
	},
	conditions: [],
	check: {
		script: "scripts/measure/test-rules.mjs",
		measure:
			"hits of the three test rules (bare assertion, expect inside a branch or mock, early return), tests that match nothing, mutation score, and retyped thresholds",
		budget: "ratchet rows tests.lint and measure/*: they only fall",
	},
	rubric:
		"A test asserts every claim in its name, the exact value the behaviour produces, and fails when it cannot set up its condition. A passing run with no tests matched is a failure.",
	status: "active",
});
