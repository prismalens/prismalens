// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useState } from "react";
import {
	CHANNEL_LABEL,
	CommandLine,
	useAbout,
} from "@/components/settings/AboutSettings";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { useFactoryReset, useResetData } from "@/lib/api/hooks";

export function DangerZoneSettings() {
	const { data: about } = useAbout();
	const [showResetDialog, setShowResetDialog] = useState(false);
	const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false);

	const resetData = useResetData();
	const factoryReset = useFactoryReset();

	const handleResetData = () =>
		resetData.mutateAsync({ confirmation: "RESET" });

	const handleFactoryReset = async () => {
		await factoryReset.mutateAsync({ confirmation: "FACTORY RESET" });
		window.location.href = "/setup";
	};

	return (
		<>
			<SettingGroup title="Records" testId="danger-zone">
				<Pool>
					<SettingRow
						label="Reset all data"
						description="Deletes every alert, incident and run; services, integrations and settings stay"
					>
						<Button
							variant="danger"
							onClick={() => setShowResetDialog(true)}
							data-testid="reset-data"
						>
							Reset data
						</Button>
					</SettingRow>
					<SettingRow
						label="Factory reset"
						description="Reset data, plus every service, integration and setting; devices stay paired"
					>
						<Button
							variant="danger"
							onClick={() => setShowFactoryResetDialog(true)}
						>
							Factory reset
						</Button>
					</SettingRow>
				</Pool>
			</SettingGroup>

			<DestructiveConfirm
				open={showResetDialog}
				onOpenChange={setShowResetDialog}
				title="Reset all data?"
				description={
					<>
						<p>This permanently deletes:</p>
						<ul>
							<li>All alerts</li>
							<li>All incidents</li>
							<li>All investigations</li>
							<li>All recommendations</li>
						</ul>
						<p>Services, integrations and settings stay.</p>
					</>
				}
				confirmWord="RESET"
				confirmLabel="Reset all data"
				onConfirm={handleResetData}
				isPending={resetData.isPending}
				error={resetData.error}
			/>

			{about && (
				<SettingGroup
					title="Uninstall PrismaLens"
					description={
						<>
							Uninstalling keeps the workspace at{" "}
							<Mono>{about.workspaceDir}</Mono>. Factory reset first to remove
							the data too.
						</>
					}
				>
					<Pool>
						<SettingRow
							label={`Installed with ${CHANNEL_LABEL[about.channel]}`}
							description={
								about.channel === "electron"
									? "Quit PrismaLens from the tray, then delete the app"
									: "Stop pl up, then run this"
							}
							below={
								about.channel !== "electron" && (
									<CommandLine command={about.uninstallCommand} />
								)
							}
						/>
					</Pool>
				</SettingGroup>
			)}

			<DestructiveConfirm
				open={showFactoryResetDialog}
				onOpenChange={setShowFactoryResetDialog}
				title="Factory reset?"
				description={
					<>
						<p>
							This permanently deletes <strong>everything</strong>:
						</p>
						<ul>
							<li>All alerts, incidents and investigations</li>
							<li>All services, integrations and connections</li>
							<li>All settings</li>
						</ul>
						<p>Paired devices stay paired.</p>
					</>
				}
				confirmWord="FACTORY RESET"
				confirmLabel="Factory reset"
				onConfirm={handleFactoryReset}
				isPending={factoryReset.isPending}
				error={factoryReset.error}
			/>
		</>
	);
}
