// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFactoryReset, useResetData } from "@/lib/api/hooks";

export function DangerZoneSettings() {
	const [showResetDialog, setShowResetDialog] = useState(false);
	const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false);
	const [confirmText, setConfirmText] = useState("");

	const resetData = useResetData();
	const factoryReset = useFactoryReset();

	const handleResetData = async () => {
		try {
			await resetData.mutateAsync({ confirmation: "RESET" });
			setShowResetDialog(false);
			setConfirmText("");
		} catch {
			// error is surfaced via resetData.error
		}
	};

	const handleFactoryReset = async () => {
		try {
			await factoryReset.mutateAsync({ confirmation: "FACTORY RESET" });
			setShowFactoryResetDialog(false);
			setConfirmText("");
			// Redirect to setup wizard
			window.location.href = "/setup";
		} catch {
			// error is surfaced via factoryReset.error
		}
	};

	return (
		<>
			<Card className="border-destructive/30">
				<CardHeader>
					<div className="flex items-center gap-2">
						<AlertTriangle className="h-5 w-5 text-destructive" />
						<CardTitle className="text-destructive">Danger Zone</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{/* Reset Data */}
					<div className="flex justify-between items-center p-4 border rounded-lg">
						<div>
							<h3 className="font-medium text-foreground">Reset All Data</h3>
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
							Reset Data
						</Button>
					</div>

					{/* Factory Reset */}
					<div className="flex justify-between items-center p-4 border rounded-lg">
						<div>
							<h3 className="font-medium text-foreground">Factory Reset</h3>
							<p className="text-sm text-muted-foreground">
								Delete ALL data and return to initial setup state. This removes
								users, services, and all configurations.
							</p>
						</div>
						<Button
							variant="destructive"
							onClick={() => setShowFactoryResetDialog(true)}
						>
							<AlertTriangle className="mr-2 h-4 w-4" />
							Factory Reset
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Reset Data Dialog */}
			<AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Reset All Data?</AlertDialogTitle>
						<AlertDialogDescription className="space-y-2">
							<p>This will permanently delete:</p>
							<ul className="list-disc list-inside text-sm">
								<li>All alerts</li>
								<li>All incidents</li>
								<li>All investigations</li>
								<li>All recommendations</li>
							</ul>
							<p className="pt-2">
								Services, integrations, and settings will be preserved.
							</p>
							<div className="pt-4">
								<Label htmlFor="confirm-reset">
									Type <strong>RESET</strong> to confirm
								</Label>
								<Input
									id="confirm-reset"
									value={confirmText}
									onChange={(e) => setConfirmText(e.target.value)}
									placeholder="RESET"
									className="mt-2"
								/>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<MutationError error={resetData.error} />
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setConfirmText("")}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={confirmText !== "RESET" || resetData.isPending}
							onClick={handleResetData}
							className="bg-destructive hover:bg-destructive/90"
						>
							{resetData.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Reset All Data
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Factory Reset Dialog */}
			<AlertDialog
				open={showFactoryResetDialog}
				onOpenChange={setShowFactoryResetDialog}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Factory Reset?</AlertDialogTitle>
						<AlertDialogDescription className="space-y-2">
							<p>
								This will permanently delete <strong>everything</strong>:
							</p>
							<ul className="list-disc list-inside text-sm">
								<li>All users (except owner)</li>
								<li>All services</li>
								<li>All integrations</li>
								<li>All alerts, incidents, and investigations</li>
								<li>All settings and configurations</li>
							</ul>
							<p className="pt-2">
								You will be redirected to the setup wizard to start fresh.
							</p>
							<div className="pt-4">
								<Label htmlFor="confirm-factory-reset">
									Type <strong>FACTORY RESET</strong> to confirm
								</Label>
								<Input
									id="confirm-factory-reset"
									value={confirmText}
									onChange={(e) => setConfirmText(e.target.value)}
									placeholder="FACTORY RESET"
									className="mt-2"
								/>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<MutationError error={factoryReset.error} />
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setConfirmText("")}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								confirmText !== "FACTORY RESET" || factoryReset.isPending
							}
							onClick={handleFactoryReset}
							className="bg-destructive hover:bg-destructive/90"
						>
							{factoryReset.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Factory Reset
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
