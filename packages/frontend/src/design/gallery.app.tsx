// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { About } from "@prismalens/contracts";
import { UpdateAvailable } from "@/components/settings/about/UpdatesPanel";
import { ProjectMark } from "@/components/shared/ProjectMark";
import { ColdDock } from "@/components/thread/session/ColdDock";
import {
	ContextMeter,
	MeterRing,
} from "@/components/thread/session/ContextMeter";
import { LimitDock } from "@/components/thread/session/LimitDock";
import {
	CompactionNode,
	LimitNode,
} from "@/components/thread/session/SessionNodes";
import type { ThreadLimit } from "@/components/thread/session/session-words";
import type { GallerySection } from "./gallery";

const NOW = Date.parse("2026-11-11T15:35:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const clock = (iso: string) => iso.slice(11, 16);
const noop = () => {};

const LIMITS: { label: string; limit: ThreadLimit }[] = [
	{
		label: "Known reset, resuming",
		limit: {
			since: at(-5),
			autoResume: true,
			resetsAt: at(8),
			nextAttemptAt: at(10),
			attempts: 1,
		},
	},
	{
		label: "Unknown reset, counting",
		limit: {
			since: at(-30),
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: at(35),
			attempts: 2,
			maxAttempts: 6,
		},
	},
	{
		label: "Auto-resume off",
		limit: { since: at(-5), autoResume: false, resetsAt: at(10), attempts: 1 },
	},
	{
		label: "Gave up",
		limit: {
			since: at(-200),
			autoResume: true,
			resetsAt: null,
			attempts: 7,
			gaveUp: true,
		},
	},
];

const ABOUT: About = {
	version: "0.5.4",
	channel: "installer",
	build: null,
	workspaceDir: "/home/me/.prismalens",
	latestBackup: null,
	update: {
		latest: "0.5.5",
		available: true,
		checkedAt: at(-60),
		disabledBy: null,
		releaseNotesUrl: null,
		notes: "### Fixes\n- Threads keep their draft while a dock decides.",
		install: { available: true },
	},
	upgradeCommand: "pl upgrade",
	uninstallCommand: "pl uninstall",
};

const INSTALL_STATES: { label: string; about: About; liveRuns?: number }[] = [
	{ label: "Available", about: ABOUT },
	{
		label: "Blocked by live runs",
		about: {
			...ABOUT,
			update: {
				...ABOUT.update,
				install: { available: false, blockedBy: "busy" },
			},
		},
		liveRuns: 2,
	},
	{
		label: "npm copy",
		about: {
			...ABOUT,
			channel: "npm",
			upgradeCommand: "npm i -g prismalens@latest",
			update: {
				...ABOUT.update,
				install: { available: false, blockedBy: "not_installer" },
			},
		},
	},
];

const ROW = "grid gap-2";

/** UI 3's states in the gallery (#1024). Only UI 3 edits this file. */
export const appGallery: GallerySection[] = [
	{
		id: "context-meter",
		title: "Context meter at three tones",
		render: () => (
			<div className="flex items-center gap-4">
				{[45, 78, 94].map((p) => (
					<span
						key={p}
						className="flex items-center gap-1 text-meta text-text-2"
					>
						<MeterRing percent={p} />
						{p}%
					</span>
				))}
				<ContextMeter
					usage={{ used: 142_000, size: 200_000 }}
					session={{ cache: "warm", compactCommand: "compact" }}
					onCompact={noop}
				/>
			</div>
		),
	},
	{
		id: "compaction-nodes",
		title: "Compaction in the transcript",
		render: () => (
			<div className={ROW}>
				<CompactionNode event={{ phase: "started", method: "agent_command" }} />
				<CompactionNode
					event={{
						phase: "completed",
						method: "agent_command",
						before: 142_000,
						after: 18_000,
						instructions: "keep the API notes",
					}}
				/>
				<CompactionNode
					event={{ phase: "failed", method: "summary" }}
					onRetry={noop}
				/>
				<LimitNode
					event={{ kind: "usage_limit", agent: "The agent", resetsAt: at(10) }}
				/>
				<LimitNode
					event={{ kind: "resume_scheduled", at: at(10), attempt: 1 }}
				/>
				<LimitNode event={{ kind: "resumed", reason: "limit_reset" }} />
			</div>
		),
	},
	{
		id: "cold-dock",
		title: "Cold conversation",
		render: () => (
			<ColdDock tokens={140_000} canCompact onChoose={noop} onCancel={noop} />
		),
	},
	{
		id: "limit-dock",
		title: "Usage limit",
		render: () => (
			<div className={ROW}>
				{LIMITS.map((l) => (
					<LimitDock
						key={l.label}
						limit={l.limit}
						draft="Check the logs from the last deploy"
						now={NOW}
						clock={clock}
						onDontResume={noop}
						onSendAtReset={noop}
						onSendNow={noop}
					/>
				))}
			</div>
		),
	},
	{
		id: "about-install",
		title: "About, install states",
		render: () => (
			<div className={ROW}>
				{INSTALL_STATES.map((s) => (
					<UpdateAvailable
						key={s.label}
						about={s.about}
						liveRuns={s.liveRuns}
					/>
				))}
			</div>
		),
	},
	{
		id: "project-mark",
		title: "Project faces",
		render: () => (
			<div className="flex items-center gap-3">
				<ProjectMark
					name="acme/api"
					images
					iconUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Crect width='8' height='8' fill='%23888'/%3E%3C/svg%3E"
				/>
				<ProjectMark name="acme/api" images={false} />
				<ProjectMark name="shop" size="lg" images={false} />
			</div>
		),
	},
];
