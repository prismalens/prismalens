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
import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/llm";
import type { HarnessSetting, HarnessStatus } from "@prismalens/contracts";
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

const IMPLEMENTED_HARNESSES = Object.values(HARNESS_REGISTRY).filter(
	(descriptor) => descriptor.implemented,
);

// Mirrors the worker's job-time compatibility gate (processor.ts
// `speaksOpenAiProtocol` + the claude-code anthropic check). Duplicated because a
// registry field for it is deferred — ADR-0031 §4; keep the two in step (#501).
const OPENAI_PROTOCOL_PROVIDERS: readonly LLMProviderId[] = [
	"openai",
	"ollama",
	"custom",
];

function providerName(provider: LLMProviderId): string {
	return LLM_PROVIDERS[provider]?.name ?? provider;
}

/**
 * Why an explicitly pinned harness cannot run against the active provider, or
 * null when it can. `auto` never lands here — it picks a compatible harness.
 */
function describeMismatch(
	harness: HarnessId,
	activeProvider: LLMProviderId | null | undefined,
): string | null {
	if (!activeProvider) return null;
	if (harness === "claude-code" && activeProvider !== "anthropic") {
		return `Claude Code runs against Anthropic. The active provider is ${providerName(activeProvider)}.`;
	}
	if (
		harness === "deepagents" &&
		!OPENAI_PROTOCOL_PROVIDERS.includes(activeProvider)
	) {
		return `deepagents speaks the OpenAI protocol. The active provider is ${providerName(activeProvider)}.`;
	}
	return null;
}

function VerdictBadge({ status }: { status: HarnessStatus }) {
	const { verdict } = status;

	if (!verdict.usable) {
		return (
			<Badge
				variant="outline"
				className="border-amber-600 text-amber-700 dark:text-amber-400"
			>
				Not authenticated
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
	const mismatch =
		selected === "auto"
			? null
			: describeMismatch(selected, settings?.activeProvider);
	const unusableReason =
		selectedStatus && !selectedStatus.verdict.usable
			? selectedStatus.verdict.reason
			: null;

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
							return (
								<div
									key={descriptor.id}
									className="flex items-start gap-3 rounded-lg border p-3"
								>
									<RadioGroupItem
										value={descriptor.id}
										id={`harness-${descriptor.id}`}
										className="mt-1"
									/>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<Label
												htmlFor={`harness-${descriptor.id}`}
												className="font-medium"
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
										{status && !status.verdict.usable && (
											<p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
												{status.verdict.reason}
											</p>
										)}
									</div>
								</div>
							);
						})}
					</RadioGroup>

					{(unusableReason || mismatch) && selectedDescriptor && (
						<Alert data-testid="harness-warning">
							<AlertTriangle className="h-4 w-4" />
							<AlertTitle>
								{mismatch
									? `${selectedDescriptor.label} does not match the active provider`
									: `${selectedDescriptor.label} is not authenticated`}
							</AlertTitle>
							<AlertDescription className="space-y-1">
								<p>{mismatch ?? unusableReason}</p>
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
