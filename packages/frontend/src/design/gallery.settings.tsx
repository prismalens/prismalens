// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ThreadTitleOptions,
	ThreadTitlesRow,
} from "@/components/settings/ModelsSettings";
import { SettingsResults } from "@/components/settings/SettingsSearch";
import { Keys } from "@/components/settings/ShortcutsSettings";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { GallerySection } from "./gallery";

const noop = () => {};

/** Settings states (#1101 cat 18): search, Reset, host-only, a dangerous row and a remap. */
export const settingsGallery: GallerySection[] = [
	{
		id: "settings-thread-titles",
		title: "Models settings: Thread titles, its use row and options",
		render: () => (
			<div className="max-w-[42rem]">
				<SettingGroup title="Default per use">
					<Pool>
						<ThreadTitlesRow />
					</Pool>
				</SettingGroup>
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
				<SettingGroup title="Threads agents start">
					<Pool>
						<SettingRow
							label="Thread depth"
							description="Levels below the thread you start"
							changed
							onReset={noop}
						>
							<Button variant="secondary" size="sm">
								4
							</Button>
						</SettingRow>
						<SettingRow
							label="Turns a day"
							description="Thread starts and messages agents send each other in 24 hours"
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
						label="Go to Threads"
						description="Press the key after G. Esc cancels."
						below={
							<p className="text-meta text-danger" role="alert">
								G S already does Go to Services. Try another key.
							</p>
						}
					>
						<Keys keys="G T" />
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
];
