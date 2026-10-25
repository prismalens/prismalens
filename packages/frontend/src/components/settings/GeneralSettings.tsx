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

/**
 * Settings, General (#848): app-wide behaviour. Only the sidebar's width is
 * built here; the other rows wait for their stored settings (#932).
 */
export function GeneralSettings() {
	const { sidebarRest, setSidebarRest } = useLayoutPrefs();
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
