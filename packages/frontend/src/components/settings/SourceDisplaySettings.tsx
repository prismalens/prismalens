// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Switch } from "@/components/ui/switch";
import { useOperator } from "@/hooks/use-operator";
import {
	useHostImages,
	useSetHostImages,
	useThreadContextSettings,
	useUpdateThreadContextSettings,
} from "@/lib/api/hooks/use-app-settings-orpc";

const HOST_ONLY = "Only the computer running PrismaLens can change this.";

/** Sources → what PrismaLens reads from the git host beyond code (#1024). */
export function SourceDisplayGroup() {
	const context = useThreadContextSettings();
	const updateContext = useUpdateThreadContextSettings();
	const images = useHostImages();
	const setImages = useSetHostImages();
	const { managesPairing: host } = useOperator();
	// The same switch stops automatic pull request updates, not only the status line.
	const prStatus = context.data?.prStatus !== false;
	return (
		<SettingGroup title="From the git host" testId="sources-host-display">
			<Pool>
				<SettingRow
					label={
						<label htmlFor="sources-pr-status">Show pull request status</label>
					}
					description={host ? "Threads follow their pull requests" : HOST_ONLY}
					testId="sources-pr-status-row"
				>
					<Switch
						id="sources-pr-status"
						checked={prStatus}
						disabled={!context.data || updateContext.isPending || !host}
						onCheckedChange={(on) => updateContext.mutate({ prStatus: on })}
						data-testid="sources-pr-status"
					/>
				</SettingRow>
				<SettingRow
					label={
						<label htmlFor="sources-host-images">
							Images from the git host
						</label>
					}
					description="Project logos and owner avatars"
					testId="sources-host-images-row"
				>
					<Switch
						id="sources-host-images"
						checked={images}
						disabled={setImages.isPending}
						onCheckedChange={(enabled) => setImages.mutate({ enabled })}
						data-testid="sources-host-images"
					/>
				</SettingRow>
			</Pool>
		</SettingGroup>
	);
}
