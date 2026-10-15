// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { MutationError } from "@/components/shared/MutationError";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Switch } from "@/components/ui/switch";
import {
	useCaseFileSettings,
	useUpdateCaseFileSettings,
} from "@/lib/api/hooks/use-case-files-orpc";

export const CASE_FILE_DESCRIPTION =
	"At alert time, PrismaLens runs a fixed read-only kubectl checklist against a service's bound target and keeps a redacted, verifiable record.";

/** Settings, Experiments: features still being tried, each off until turned on. */
export function ExperimentsSettings() {
	const settings = useCaseFileSettings();
	const update = useUpdateCaseFileSettings();
	return (
		<>
			<SettingGroup title="Experiments">
				<Pool>
					<SettingRow
						label={
							<label htmlFor="case-file-enabled">
								Case File capture (experiment)
							</label>
						}
						description={CASE_FILE_DESCRIPTION}
						testId="case-file-row"
					>
						<Switch
							id="case-file-enabled"
							checked={settings.data?.enabled ?? false}
							disabled={!settings.data || update.isPending}
							onCheckedChange={(enabled) => update.mutate({ enabled })}
							data-testid="case-file-switch"
						/>
					</SettingRow>
				</Pool>
			</SettingGroup>
			{settings.isError && (
				<p className="mt-2 text-body text-text-2">
					Could not read this setting, so it shows off.
				</p>
			)}
			<MutationError error={update.error} className="mt-2" />
		</>
	);
}
