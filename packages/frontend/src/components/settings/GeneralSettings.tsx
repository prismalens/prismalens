// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
import {
	useThreadSettings,
	useUpdateThreadSettings,
} from "@/lib/api/hooks/use-threads-orpc";

const SETTLE_DAYS = [1, 3, 7, 14, 30] as const;

/**
 * Settings, General (#848): app-wide behaviour: the sidebar's width, and when
 * quiet threads settle (#1020).
 */
export function GeneralSettings() {
	const { sidebarRest, setSidebarRest } = useLayoutPrefs();
	return (
		<>
			<SidebarGroup sidebarRest={sidebarRest} setSidebarRest={setSidebarRest} />
			<ThreadsGroup />
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
						<SelectTrigger
							aria-label="Sidebar"
							className="w-36"
							data-testid="general-sidebar"
						>
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
					description="Chats with no activity move to Settled."
				>
					<Select
						value={days ? String(days) : undefined}
						disabled={!days || update.isPending}
						onValueChange={(v) => update.mutate({ settleAfterDays: Number(v) })}
					>
						<SelectTrigger
							aria-label="Settle quiet threads"
							className="w-36"
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
