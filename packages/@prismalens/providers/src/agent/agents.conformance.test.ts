// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "vitest";
import { conformance } from "../conformance/index.ts";
import type { EntryPointDef } from "../descriptor.ts";
import { agents } from "../index.ts";
import { builtIn } from "../registry.gen.ts";
import { type AgentDef, type CheckedModes, installCommand } from "./family.ts";

const LEVELS = ["supervised", "auto-edits", "auto", "full-access"] as const;
const REQUIRED = Object.values(builtIn)
	.flatMap((m) => Object.values(m) as EntryPointDef[])
	.filter((e) => e.kind === "entryPoint" && e.family === "agent" && e.required)
	.map((e) => e.id)
	.sort();
const CHECKS: CheckedModes[] = [null, { modes: [] }];
const asAgent = (p: unknown) => p as AgentDef;

conformance("agent", agents(), [
	{
		id: "entry-points",
		title: "offers every required agent entry point",
		run: (p) => expect(REQUIRED.filter((id) => !p.entryPoints.includes(id))).toEqual([]),
	},
	{
		id: "launch",
		title: "is named after the launch row it runs",
		run: (p) => expect(p.id).toBe(`agent.${asAgent(p).launch}`),
	},
	{
		id: "lines",
		title: "names itself on every level's line, checked or not",
		run: (p) => {
			const { lines } = asAgent(p).facts;
			const missing = LEVELS.flatMap((l) =>
				CHECKS.filter((c) => !lines[l](c).includes(p.name)).map((c) => `${l} ${JSON.stringify(c)}`),
			);
			expect(missing).toEqual([]);
		},
	},
	{
		id: "install",
		title: "has an install hint that gives its channel's command",
		run: (p) => {
			const { install, channel } = asAgent(p).facts;
			if (!channel) throw new Error(`${p.id} has no install channel; skip "install" with the reason`);
			expect(install).toContain(installCommand(channel));
		},
	},
	{
		id: "unattended",
		title: "offers a sign-in method alert and scheduled runs may use",
		run: (p) => expect(p.auth?.methods?.some((m) => m.unattended)).toBe(true),
	},
]);
