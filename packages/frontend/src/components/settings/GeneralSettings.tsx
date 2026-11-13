// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContextSettings } from "@prismalens/contracts";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type SidebarRest, useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useOperator } from "@/hooks/use-operator";
import {
	useEditors,
	useThreadContextSettings,
	useUpdateThreadContextSettings,
} from "@/lib/api/hooks/use-app-settings-orpc";
import {
	useThreadSettings,
	useUpdateThreadSettings,
} from "@/lib/api/hooks/use-threads-orpc";

const SETTLE_DAYS = [1, 3, 7, 14, 30] as const;

/**
 * Settings, General (#848): app-wide behaviour: the sidebar's width, and when
 * quiet threads settle (#1020), and the editor files open in (#1024).
 */
export function GeneralSettings() {
	const { sidebarRest, setSidebarRest } = useLayoutPrefs();
	return (
		<>
			<SidebarGroup sidebarRest={sidebarRest} setSidebarRest={setSidebarRest} />
			<ThreadsGroup />
			<FilesGroup />
		</>
	);
}

function SidebarGroup({
	sidebarRest,
	setSidebarRest,
}: {
	sidebarRest: SidebarRest;
	setSidebarRest: (v: SidebarRest) => void;
}) {
	return (
		<SettingGroup title="Layout" testId="general-layout">
			<Pool>
				<SettingRow
					label="Sidebar"
					description="Folded shows icons only. Press [ to hide it."
				>
					<Select
						value={sidebarRest}
						onValueChange={(v) => setSidebarRest(v as SidebarRest)}
					>
						<SelectTrigger aria-label="Sidebar" data-testid="general-sidebar">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="full">Full</SelectItem>
							<SelectItem value="folded">Folded</SelectItem>
						</SelectContent>
					</Select>
				</SettingRow>
			</Pool>
		</SettingGroup>
	);
}

function ThreadsGroup() {
	const settings = useThreadSettings();
	const update = useUpdateThreadSettings();
	const days = settings.data?.settleAfterDays;
	return (
		<SettingGroup title="Threads" testId="general-threads">
			<Pool>
				<SettingRow
					label="Settle quiet threads"
					// A node, not a string, so the line shows rather than hiding in a hint.
					description={
						<span data-testid="general-settle-hint">
							Moves to Settled and stops its watches
						</span>
					}
				>
					<Select
						value={days ? String(days) : undefined}
						disabled={!days || update.isPending}
						onValueChange={(v) => update.mutate({ settleAfterDays: Number(v) })}
					>
						<SelectTrigger
							aria-label="Settle quiet threads"
							data-testid="general-settle-days"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Array.from(new Set([...SETTLE_DAYS, ...(days ? [days] : [])]))
								.sort((a, b) => a - b)
								.map((d) => (
									<SelectItem key={d} value={String(d)}>
										{d === 1 ? "1 day" : `${d} days`}
									</SelectItem>
								))}
						</SelectContent>
					</Select>
				</SettingRow>
			</Pool>
		</SettingGroup>
	);
}

/** "Open files in": the system's default app, or an editor found on this computer's PATH. */
function FilesGroup() {
	const settings = useThreadContextSettings();
	const editors = useEditors();
	const update = useUpdateThreadContextSettings();
	const { managesPairing: host } = useOperator();
	const value = settings.data?.editor ?? "system";
	const listed = editors.data?.editors ?? [];
	// A saved editor that left PATH stays listed, so the choice never vanishes.
	const missing = value !== "system" && !listed.some((e) => e.id === value);
	return (
		<SettingGroup title="Files" testId="general-files">
			<Pool>
				<SettingRow
					label={<span id="general-editor-label">Open files in</span>}
					description={
						host
							? "Paths in threads open here"
							: "Only the computer running PrismaLens can change this."
					}
				>
					<Select
						value={value}
						disabled={!settings.data || update.isPending || !host}
						onValueChange={(v) =>
							update.mutate({ editor: v as ThreadContextSettings["editor"] })
						}
					>
						<SelectTrigger
							aria-labelledby="general-editor-label"
							data-testid="general-editor"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="system">System default</SelectItem>
							{listed.map((e) => (
								<SelectItem key={e.id} value={e.id}>
									{e.label}
								</SelectItem>
							))}
							{missing && (
								<SelectItem value={value}>{`${value} (not found)`}</SelectItem>
							)}
						</SelectContent>
					</Select>
				</SettingRow>
			</Pool>
		</SettingGroup>
	);
}
