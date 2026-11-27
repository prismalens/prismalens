// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_IDS, HARNESS_REGISTRY } from "@prismalens/config/harness";
import type {
	AgentLoadout,
	SharedServerPreview,
	SharedSet,
} from "@prismalens/contracts";
import { AgentLoadoutView } from "@/components/settings/AgentLoadout";
import { SharedSetOfferView } from "@/components/settings/SharedSetOffer";
import {
	SharedSetView,
	ShareServerForm,
} from "@/components/settings/SharedSetSettings";
import type { GallerySection } from "./gallery";

const noop = () => {};
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

// The first three agents the registry lists, so the gallery names no agent by hand.
const AGENTS = HARNESS_IDS.slice(0, 3).map((id) => ({
	id,
	label: HARNESS_REGISTRY[id].label,
}));
const [A, B, C] = AGENTS.map((a) => a.id);
const labelOf = (id: string) => AGENTS.find((a) => a.id === id)?.label ?? id;

const loadout: AgentLoadout = {
	agent: A,
	repositoryId: "r-1",
	profile: "own",
	readAt: hoursAgo(0),
	readable: true,
	report: { at: hoursAgo(2), threadId: "t-1" },
	staleReport: null,
	items: [
		{
			kind: "instructions",
			name: "CLAUDE.md",
			scope: "global",
			path: "~/.claude/CLAUDE.md",
			disk: true,
			reported: hoursAgo(2),
			state: "loads",
		},
		{
			kind: "skill",
			name: "review",
			scope: "global",
			path: "~/.claude/skills/review",
			disk: true,
			reported: null,
			state: "found",
		},
		{
			kind: "mcp",
			name: "github",
			scope: "repo",
			path: ".mcp.json",
			disk: true,
			reported: hoursAgo(2),
			state: "in-project",
		},
		{
			kind: "mcp",
			name: "pl-tickets",
			scope: "prismalens",
			path: null,
			disk: false,
			reported: null,
			state: "not-sent",
			note: "Not sent: needs values",
		},
		{
			kind: "hook",
			name: "PreToolUse",
			scope: "global",
			path: "~/.claude/settings.json",
			disk: true,
			reported: null,
			state: "failed",
		},
	],
};

const set: SharedSet = {
	decided: "shared",
	instructions:
		"Prefer read-only commands. Name the file and line for every claim.",
	instructionsFor: [A, B],
	revision: "r1",
	servers: [
		{
			name: "docs",
			transport: "stdio",
			command: "node",
			argCount: 2,
			host: null,
			valueNames: ["DOCS_TOKEN"],
			missingValues: ["DOCS_TOKEN"],
			recipients: [A, B],
			changedInSource: false,
			fromAgent: B,
			fromSource: {
				agent: B,
				path: "~/.config/agent/config.json",
				key: "docs",
			},
		},
		{
			name: "tickets",
			transport: "http",
			command: null,
			argCount: 0,
			host: "mcp.example.com",
			valueNames: [],
			missingValues: [],
			recipients: [A],
			changedInSource: true,
			fromAgent: C,
			fromSource: {
				agent: C,
				path: "~/.config/agent/config.json",
				key: "tickets",
			},
		},
	],
};

const preview: SharedServerPreview = {
	source: { agent: B, path: "~/.config/agent/config.json", key: "docs" },
	transport: "stdio",
	command: "/usr/local/bin/node",
	args: [null, null],
	origin: null,
	hasPath: false,
	removed: [],
	env: ["DOCS_TOKEN"],
	headers: [],
	revision: "r-docs",
};

/** Settings → Agents (#1180 §3.1-§3.3): What loads, the PrismaLens set, its share form and the first-run offer. */
export const agentsGallery: GallerySection[] = [
	{
		id: "settings-agent-loadout",
		title:
			"Agent: What loads, with a report, a project server and one not sent",
		render: () => (
			<div className="max-w-[42rem]">
				<AgentLoadoutView loadout={loadout} now={NOW} />
			</div>
		),
	},
	{
		id: "settings-agent-loadout-unreadable",
		title:
			"Agent: What loads for an agent PrismaLens cannot read, after a changed setup",
		render: () => (
			<div className="max-w-[42rem]">
				<AgentLoadoutView
					loadout={{
						...loadout,
						readable: false,
						report: null,
						staleReport: { at: hoursAgo(26), threadId: "t-0" },
						items: [],
					}}
					now={NOW}
				/>
			</div>
		),
	},
	{
		id: "settings-shared-set",
		title:
			"Agents: the PrismaLens set, a server needing values and one changed at its source",
		render: () => (
			<div className="max-w-[42rem]">
				<SharedSetView
					set={set}
					agents={AGENTS}
					labelOf={labelOf}
					canEdit
					saving={false}
					onSaveInstructions={async () => undefined}
					onShare={noop}
					onCopyAgain={noop}
					onRemove={noop}
					onMember={noop}
				/>
			</div>
		),
	},
	{
		id: "settings-shared-set-share",
		title: "Agents: sharing a server, every argument as dots until revealed",
		render: () => (
			<div className="max-w-[40rem]">
				<ShareServerForm
					sources={[{ ...preview.source, transport: "stdio" }]}
					agents={AGENTS}
					labelOf={labelOf}
					initial={preview.source}
					preview={preview}
					previewing={false}
					onPick={noop}
					onReveal={async () => "server.js"}
					onApprove={noop}
					pending={false}
					error={null}
				/>
			</div>
		),
	},
	{
		id: "settings-shared-set-offer",
		title: "Agents: the first-run offer",
		render: () => (
			<div className="max-w-[42rem]">
				<SharedSetOfferView pending={false} onAsIs={noop} onShare={noop} />
			</div>
		),
	},
];
