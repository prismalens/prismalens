// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { CheckAllButton, CheckTimes } from "@/components/settings/agent-checks";
import { ThreadTitleOptions } from "@/components/settings/ModelsSettings";
import { SettingsResults } from "@/components/settings/SettingsSearch";
import { Keys } from "@/components/settings/ShortcutsSettings";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { GallerySection } from "./gallery";
import { agentsGallery } from "./gallery.agents";

const noop = () => {};

const checkedAgent = {
	id: "codex",
	label: "Codex",
	installed: true,
	off: false,
	checked: {
		at: new Date(Date.now() - 3 * 60_000).toISOString(),
		lastTry: {
			at: new Date(Date.now() - 60_000).toISOString(),
			outcome: "no-answer",
			detail: "no answer",
		},
	},
} as unknown as HarnessStatus;

/** Settings states (#1101 cat 18): search, Reset, host-only, a dangerous row and a remap. */
export const settingsGallery: GallerySection[] = [
	{
		id: "settings-agent-checks",
		title: "Agents: Check all, the kept check's time and a newer failed try",
		render: () => (
			<div className="max-w-[42rem]">
				<SettingGroup
					title="Agents"
					actions={<CheckAllButton agents={[checkedAgent]} />}
				>
					<Pool>
						<CheckTimes agent={checkedAgent} />
					</Pool>
				</SettingGroup>
			</div>
		),
	},
	{
		id: "settings-thread-titles",
		title: "Models settings: Thread titles",
		render: () => (
			<div className="max-w-[42rem]">
				<ThreadTitleOptions />
			</div>
		),
	},
	{
		id: "settings-search",
		title: "Settings search: results for model",
		render: () => (
			<div className="max-w-[42rem]">
				<SettingsResults query="model" />
			</div>
		),
	},
	{
		id: "settings-rows",
		title: "Settings rows: changed with Reset, host-only, a stated risk",
		render: () => (
			<div className="max-w-[42rem]">
				<SettingGroup title="Agent-started threads">
					<Pool>
						<SettingRow
							label="Messages per pair"
							description="Between two threads in 24 hours; past it they stay unread"
							changed
							onReset={noop}
						>
							<Button variant="secondary" size="sm">
								4
							</Button>
						</SettingRow>
						<SettingRow
							label="A day"
							description="Thread starts and messages agents send in 24 hours"
							changed
							onReset={noop}
							locked="Only the computer running PrismaLens can change this."
						>
							<Button variant="secondary" size="sm" disabled>
								500
							</Button>
						</SettingRow>
						<SettingRow
							label="Keep the GitHub token"
							description={
								<>
									Only threads you start.{" "}
									<span className="text-warn">
										Risk: a run nobody watches can push and comment as you.
									</span>
								</>
							}
						>
							<Switch checked={false} aria-label="Keep the GitHub token" />
						</SettingRow>
					</Pool>
				</SettingGroup>
			</div>
		),
	},
	{
		id: "settings-shortcuts",
		title: "Keyboard shortcuts: default, remapped, recording, fixed",
		render: () => (
			<div className="max-w-[42rem]">
				<Pool>
					<SettingRow label="Search" description="Default">
						<Keys keys="Mod+K" />
						<Button variant="secondary" size="sm">
							Remap
						</Button>
					</SettingRow>
					<SettingRow
						label="New thread"
						description="Remapped"
						changed
						onReset={noop}
					>
						<Keys keys="Mod+Shift+N" />
						<Button variant="secondary" size="sm">
							Remap
						</Button>
					</SettingRow>
					<SettingRow
						label="Go to Alerts"
						description="Press the new keys. Esc cancels."
						below={
							<p className="text-meta text-danger" role="alert">
								Alt+O already does Go to Operations. Try another key.
							</p>
						}
					>
						<Keys keys="Alt+A" />
						<Button variant="secondary" size="sm" aria-pressed>
							Recording
						</Button>
					</SettingRow>
					<SettingRow
						label="Send, at the agent's next pause"
						description="Fixed: it belongs to the box or list it works in"
					>
						<Keys keys="Enter" />
					</SettingRow>
				</Pool>
			</div>
		),
	},
	...agentsGallery,
];
