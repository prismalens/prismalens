// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Button } from "@/components/ui/button";
import { useFactoryReset, useResetData } from "@/lib/api/hooks";

export function DangerZoneSettings() {
	const [showResetDialog, setShowResetDialog] = useState(false);
	const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false);

	const resetData = useResetData();
	const factoryReset = useFactoryReset();

	const handleResetData = async () => {
		try {
			await resetData.mutateAsync({ confirmation: "RESET" });
			setShowResetDialog(false);
		} catch {
			// error is surfaced via resetData.error
		}
	};

	const handleFactoryReset = async () => {
		try {
			await factoryReset.mutateAsync({ confirmation: "FACTORY RESET" });
			setShowFactoryResetDialog(false);
			// Redirect to setup wizard
			window.location.href = "/setup";
		} catch {
			// error is surfaced via factoryReset.error
		}
	};

	return (
		<>
			<div className="rounded-lg border border-destructive/30 bg-card p-6 space-y-6">
				<div className="flex items-center gap-2">
					<AlertTriangle className="h-5 w-5 text-destructive" />
					<h3 className="text-base font-semibold text-destructive">
						Danger zone
					</h3>
				</div>
				<div className="space-y-4">
					{/* Reset Data */}
					<div className="flex justify-between items-center p-4 border rounded-lg">
						<div>
							<h4 className="font-medium text-foreground">Reset all data</h4>
							<p className="text-sm text-muted-foreground">
								Delete all alerts, incidents, and investigations. Services and
								integrations will be preserved.
							</p>
						</div>
						<Button
							variant="destructive"
							onClick={() => setShowResetDialog(true)}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Reset data
						</Button>
					</div>

					{/* Factory Reset */}
					<div className="flex justify-between items-center p-4 border rounded-lg">
						<div>
							<h4 className="font-medium text-foreground">Factory reset</h4>
							<p className="text-sm text-muted-foreground">
								Delete all data and return to initial setup state. This removes
								users, services, and all configurations.
							</p>
						</div>
						<Button
							variant="destructive"
							onClick={() => setShowFactoryResetDialog(true)}
						>
							<AlertTriangle className="mr-2 h-4 w-4" />
							Factory reset
						</Button>
					</div>
				</div>
			</div>

			<DestructiveConfirm
				open={showResetDialog}
				onOpenChange={setShowResetDialog}
				title="Reset all data?"
				description={
					<>
						<p>This permanently deletes:</p>
						<ul className="list-disc list-inside">
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

			<DestructiveConfirm
				open={showFactoryResetDialog}
				onOpenChange={setShowFactoryResetDialog}
				title="Factory reset?"
				description={
					<>
						<p>
							This permanently deletes <strong>everything</strong>:
						</p>
						<ul className="list-disc list-inside">
							<li>All users except the owner</li>
							<li>All services</li>
							<li>All integrations</li>
							<li>All alerts, incidents and investigations</li>
							<li>All settings</li>
						</ul>
						<p>You return to setup afterwards.</p>
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
