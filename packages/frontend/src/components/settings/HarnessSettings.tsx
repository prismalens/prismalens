// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Settings → Harness (#337/#609 narrowing of #501/ADR-0031).
 *
 * The tier-2 harness that does the investigative legwork. `GET
 * /settings/harnesses` (ADR 0003 §9) is the only source of truth for what is
 * detected on this machine and the gate's own selection verdict, rendered
 * verbatim rather than re-derived here. The picker itself reads and writes
 * `GET`/`PATCH /settings/harness` — the persisted choice and model. That
 * persisted choice loses to `PRISMALENS_HARNESS` when the env var is set
 * (`selection.pinned`), so the picker stays editable but the card says so.
 */

import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import type { HarnessSetting } from "@prismalens/contracts";
import { AlertTriangle, CheckCircle2, Loader2, Terminal, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useHarnesses, useHarnessSettings, useUpdateHarnessSettings } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export function HarnessSettings() {
	const { data, isLoading, isError } = useHarnesses();
	const { data: settings, isLoading: settingsLoading } = useHarnessSettings();
	const updateSettings = useUpdateHarnessSettings();

	const [selected, setSelected] = useState<HarnessSetting>("auto");
	const [model, setModel] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);

	const savedHarness = settings?.harness ?? "auto";
	const savedModel = settings?.model ?? "";
	useEffect(() => {
		setSelected(savedHarness);
		setModel(savedModel);
	}, [savedHarness, savedModel]);

	const dirty = selected !== savedHarness || model !== savedModel;

	const harnesses = data?.harnesses ?? [];
	const selection = data?.selection;

	async function handleSave() {
		setSaveError(null);
		try {
			await updateSettings.mutateAsync({
				harness: selected,
				model: model.trim() || undefined,
			});
		} catch (err) {
			setSaveError(
				err instanceof Error ? err.message : "Failed to save the agent",
			);
		}
	}

	if (isLoading || settingsLoading) {
		return (
			<Card data-testid="harness-settings">
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card data-testid="harness-settings">
			<CardHeader>
				<div className="flex items-center gap-2">
					<Terminal className="h-5 w-5 text-muted-foreground" />
					<CardTitle>
						{/* CardTitle renders a plain div, so the heading gives screen
						    readers (and the e2e spec) a real landmark for this card. */}
						<h3>Investigation agent</h3>
					</CardTitle>
				</div>
				<CardDescription>
					The coding agent PrismaLens rents to do the investigative legwork.
					It authenticates on its own — a signed-in session counts, an API
					key is not always required.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-4">
				{isError && (
					<Alert data-testid="harness-status-error">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>Agent status unavailable</AlertTitle>
						<AlertDescription>
							PrismaLens could not read the agent status on this machine. You
							can still pick an agent; the badges below return once the check
							succeeds.
						</AlertDescription>
					</Alert>
				)}

				{!isError && harnesses.length === 0 && (
					<Alert data-testid="harness-none-available">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>
							No investigation agent is available on this machine
						</AlertTitle>
						<AlertDescription>
							Investigations cannot run until one of the harnesses below is
							installed.
						</AlertDescription>
					</Alert>
				)}

				{selection?.pinned && (
					<Alert data-testid="harness-pinned-notice">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>PRISMALENS_HARNESS overrides this picker</AlertTitle>
						<AlertDescription>
							The environment variable is set on this machine, so it decides
							which harness runs regardless of what is saved here. Unset it to
							let this picker take effect.
						</AlertDescription>
					</Alert>
				)}

				<div className="space-y-2" data-testid="harness-registry">
					{harnesses.map((harness) => {
						const descriptor =
							harness.id in HARNESS_REGISTRY
								? HARNESS_REGISTRY[harness.id as keyof typeof HARNESS_REGISTRY]
								: undefined;
						const isSelected = selection?.harness === harness.id;
						return (
							<div
								key={harness.id}
								className={cn(
									"flex items-start gap-3 rounded-lg border p-3",
									isSelected && "border-primary",
								)}
							>
								<div className="mt-0.5">
									{harness.installed ? (
										<CheckCircle2 className="h-4 w-4 text-muted-foreground" />
									) : (
										<XCircle className="h-4 w-4 text-muted-foreground" />
									)}
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium">{harness.label}</span>
										<code className="text-xs text-muted-foreground">
											{harness.binary}
										</code>
										{isSelected && (
											<Badge variant="secondary">Selected</Badge>
										)}
										<Badge variant={harness.installed ? "secondary" : "outline"}>
											{harness.installed ? "Installed" : "Not installed"}
										</Badge>
										<Badge variant={harness.verified ? "secondary" : "outline"}>
											{harness.verified ? "Verified" : "Unverified"}
										</Badge>
									</div>
									{descriptor && (
										<p className="mt-1 text-xs text-muted-foreground">
											<span className="capitalize">
												{descriptor.readOnlyFidelity}
											</span>{" "}
											read-only
										</p>
									)}
									{!harness.installed && (
										<p className="mt-1 text-xs text-muted-foreground">
											{harness.install}
										</p>
									)}
								</div>
							</div>
						);
					})}
				</div>

				{selection && (
					<Alert
						data-testid="harness-selection"
						variant={selection.runnable ? "default" : "destructive"}
					>
						{selection.runnable ? (
							<CheckCircle2 className="h-4 w-4" />
						) : (
							<AlertTriangle className="h-4 w-4" />
						)}
						<AlertTitle>
							{selection.runnable
								? `An investigation would start with ${selection.harness}`
								: "An investigation would not start right now"}
						</AlertTitle>
						{selection.blockedReason && (
							<AlertDescription>{selection.blockedReason}</AlertDescription>
						)}
					</Alert>
				)}

				<div className="space-y-3 border-t pt-4">
					<div className="grid gap-2">
						<Label htmlFor="harness-picker">Harness</Label>
						<Select
							value={selected}
							onValueChange={(value) => setSelected(value as HarnessSetting)}
						>
							<SelectTrigger id="harness-picker" className="w-full sm:w-80">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="auto">Auto (recommended)</SelectItem>
								{harnesses.map((harness) => (
									<SelectItem
										key={harness.id}
										value={harness.id}
										disabled={!harness.installed}
									>
										{harness.label}
										{!harness.installed ? " — not installed" : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Auto picks the first verified harness found on PATH.
						</p>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="harness-model">Model</Label>
						<Input
							id="harness-model"
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder="harness default"
							className="w-full sm:w-80"
						/>
						<p className="text-xs text-muted-foreground">
							Model id in the harness's own format. Leave empty to use the
							harness default.
						</p>
					</div>

					{saveError && (
						<div className="rounded bg-destructive/10 p-2 text-sm text-destructive">
							{saveError}
						</div>
					)}

					<div className="flex items-center gap-3">
						<Button
							onClick={handleSave}
							disabled={updateSettings.isPending || !dirty}
						>
							{updateSettings.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Save agent
						</Button>
						{!dirty && (
							<span className="text-sm text-muted-foreground">
								Saved — investigations use{" "}
								{savedHarness === "auto"
									? "automatic selection"
									: HARNESS_REGISTRY[savedHarness as keyof typeof HARNESS_REGISTRY]
										?.label ?? savedHarness}
								{savedModel ? ` (${savedModel})` : ""}.
							</span>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
