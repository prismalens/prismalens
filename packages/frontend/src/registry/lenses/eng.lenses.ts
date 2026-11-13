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
		script: ".github/workflows/dependency-audit.yml",
		measure:
			"open findings that are reachable without effort, do real harm and have a small fix",
		budget: 0,
	},
	rubric:
		"Fix now only a finding that is reachable without effort, does real harm and has a small fix; every other one goes to the one security backlog issue.",
	status: "active",
});
