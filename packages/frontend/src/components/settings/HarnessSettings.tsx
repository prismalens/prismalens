// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Settings → AI Provider → "Investigation agent" (#501, ADR-0031).
 *
 * The tier-2 harness that does the investigative legwork. Its credential is a
 * ROUTE, not a key string: `claude-code` runs off a signed-in Claude CLI session
 * as happily as off an Anthropic key. The verdicts rendered here come from
 * `GET /settings/harnesses`, which resolves them from local machine evidence —
 * this component never guesses at a credential and never rewrites the remedy
 * text the server hands back.
 */

import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type {
	HarnessAuthVerdict,
	HarnessSetting,
	HarnessStatus,
} from "@prismalens/contracts";
import { AlertTriangle, Loader2, Terminal } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	useHarnesses,
	useLlmSettings,
	useUpdateLlmSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const IMPLEMENTED_HARNESSES = Object.values(HARNESS_REGISTRY).filter(
	(descriptor) => descriptor.implemented,
);

/**
 * "Not installed" and "not authenticated" are different problems with different
 * fixes, so the label is read off the verdict's `cause` and never off its
 * wording — the backend owns the words (#518).
 */
type UnusableCause = Extract<HarnessAuthVerdict, { usable: false }>["cause"];

const UNUSABLE_LABEL: Record<UnusableCause, string> = {
	"not-implemented": "Not available",
	"not-installed": "Not installed",
	"not-authenticated": "Not authenticated",
};

function VerdictBadge({ status }: { status: HarnessStatus }) {
	const { verdict } = status;

	if (!verdict.usable) {
		return (
			<Badge
				variant="outline"
				className="border-amber-600 text-amber-700 dark:text-amber-400"
			>
				{UNUSABLE_LABEL[verdict.cause]}
			</Badge>
		);
	}

	if (verdict.route === "cli-session") {
		return (
			<div className="flex items-center gap-2">
				<Badge variant="secondary">Signed-in Claude session</Badge>
				{!verdict.verified && (
					<span className="text-xs text-muted-foreground">
						not verified on this machine
					</span>
				)}
			</div>
		);
	}

	return <Badge variant="secondary">API key</Badge>;
}

export function HarnessSettings() {
	const { data: settings, isLoading: settingsLoading } = useLlmSettings();
	const {
		data: harnessData,
		isLoading: harnessLoading,
		isError: harnessError,
	} = useHarnesses();
	const updateSettings = useUpdateLlmSettings();

	const [selected, setSelected] = useState<HarnessSetting>("auto");
	const [saveError, setSaveError] = useState<string | null>(null);

	const savedHarness = settings?.harness ?? "auto";
	useEffect(() => {
		setSelected(savedHarness);
	}, [savedHarness]);

	const statusById = new Map(
		(harnessData?.harnesses ?? []).map((status) => [status.id, status]),
	);

	const selectedStatus =
		selected === "auto" ? undefined : statusById.get(selected);
	const selectedDescriptor =
		selected === "auto" ? undefined : HARNESS_REGISTRY[selected];
	// Why a pinned harness cannot run — computed by the shared gate on the server,
	// never re-derived here. The UI owning a second copy of that rule is what put a
	// false warning on a working config and none on a broken one (#517, #518).
	const blockedReason =
		selectedStatus && !selectedStatus.runnable
			? selectedStatus.blockedReason
			: null;
	// Surface-level, not per row: with every agent unusable the step as a whole
	// cannot run, and a reader should not have to compose that from three badges.
	// Statement only — an install prompt is a product decision (#518).
	const statuses = harnessData?.harnesses ?? [];
	const noAgentAvailable =
		!harnessError &&
		statuses.length > 0 &&
		IMPLEMENTED_HARNESSES.every(
			(descriptor) => statusById.get(descriptor.id)?.runnable === false,
		);

	const unusableVerdict =
		selectedStatus && !selectedStatus.verdict.usable
			? selectedStatus.verdict
			: null;
	const blockedTitle = unusableVerdict
		? unusableVerdict.cause === "not-installed"
			? "is not installed on this machine"
			: "is not authenticated"
		: "cannot run with the current settings";

	async function handleSave() {
		setSaveError(null);
		try {
			await updateSettings.mutateAsync({ harness: selected });
		} catch (err) {
			setSaveError(
				err instanceof Error ? err.message : "Failed to save the agent",
			);
		}
	}

	if (settingsLoading || harnessLoading) {
		return (
			<Card data-testid="harness-settings">
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<TooltipProvider>
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
						It authenticates on its own — a signed-in Claude session counts, an
						API key is not always required.
					</CardDescription>
				</CardHeader>

				<CardContent className="space-y-4">
					{harnessError && (
						<Alert data-testid="harness-status-error">
							<AlertTriangle className="h-4 w-4" />
							<AlertTitle>Agent status unavailable</AlertTitle>
							<AlertDescription>
								PrismaLens could not read the agent credentials on this machine.
								You can still pick an agent; the badges return when the check
								succeeds.
							</AlertDescription>
						</Alert>
					)}

					{noAgentAvailable && (
						<Alert data-testid="harness-none-available">
							<AlertTriangle className="h-4 w-4" />
							<AlertTitle>
								No investigation agent is available on this machine
							</AlertTitle>
							<AlertDescription>
								Investigations cannot run until one of the agents below is
								available. Each row states what is missing.
							</AlertDescription>
						</Alert>
					)}

					<RadioGroup
						value={selected}
						onValueChange={(value) => setSelected(value as HarnessSetting)}
						className="space-y-2"
					>
						<div className="flex items-start gap-3 rounded-lg border p-3">
							<RadioGroupItem value="auto" id="harness-auto" className="mt-1" />
							<div className="min-w-0 flex-1">
								<Label htmlFor="harness-auto" className="font-medium">
									Auto (recommended)
								</Label>
								<p className="mt-1 text-xs text-muted-foreground">
									Picks the first agent this machine can authenticate — Claude
									Code first, then deepagents.
								</p>
							</div>
						</div>

						{IMPLEMENTED_HARNESSES.map((descriptor) => {
							const status = statusById.get(descriptor.id);
							// Unknown status (the check failed) stays selectable — only a
							// gate actually saying "would not start" disables the option.
							const unusable = status ? !status.runnable : false;
							return (
								<div
									key={descriptor.id}
									className={cn(
										"flex items-start gap-3 rounded-lg border p-3",
										unusable && "bg-muted/40",
									)}
								>
									<RadioGroupItem
										value={descriptor.id}
										id={`harness-${descriptor.id}`}
										className="mt-1"
										disabled={unusable}
									/>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<Label
												htmlFor={`harness-${descriptor.id}`}
												className={cn(
													"font-medium",
													unusable && "text-muted-foreground",
												)}
											>
												{descriptor.label}
											</Label>
											{status && <VerdictBadge status={status} />}
										</div>
										<Tooltip>
											<TooltipTrigger asChild>
												<p className="mt-1 w-fit text-xs text-muted-foreground">
													<span className="capitalize">
														{descriptor.readOnlyFidelity}
													</span>{" "}
													read-only
												</p>
											</TooltipTrigger>
											<TooltipContent className="max-w-xs">
												{descriptor.readOnlyMechanism}
											</TooltipContent>
										</Tooltip>
										{status && !status.runnable && (
											<p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
												{status.verdict.usable
													? status.blockedReason
													: status.verdict.reason}
											</p>
										)}
									</div>
								</div>
							);
						})}
					</RadioGroup>

					{blockedReason && selectedDescriptor && (
						<Alert data-testid="harness-warning">
							<AlertTriangle className="h-4 w-4" />
							<AlertTitle>{`${selectedDescriptor.label} ${blockedTitle}`}</AlertTitle>
							<AlertDescription className="space-y-1">
								<p>{blockedReason}</p>
								<p>
									Investigations pinned to this agent fail when they start.
									PrismaLens will not quietly run a different agent — each one
									enforces read-only differently, and you would get a guarantee
									you did not pick.
								</p>
							</AlertDescription>
						</Alert>
					)}

					{saveError && (
						<div className="rounded bg-destructive/10 p-2 text-sm text-destructive">
							{saveError}
						</div>
					)}

					<div className="flex items-center gap-3">
						<Button
							onClick={handleSave}
							disabled={updateSettings.isPending || selected === savedHarness}
						>
							{updateSettings.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Save agent
						</Button>
						{selected === savedHarness && (
							<span className="text-sm text-muted-foreground">
								Saved — investigations use{" "}
								{savedHarness === "auto"
									? "automatic selection"
									: HARNESS_REGISTRY[savedHarness].label}
								.
							</span>
						)}
					</div>
				</CardContent>
			</Card>
		</TooltipProvider>
	);
}
