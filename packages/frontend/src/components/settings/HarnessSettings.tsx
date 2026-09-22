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

import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type { HarnessSetting } from "@prismalens/contracts";
import {
	AlertTriangle,
	CheckCircle2,
	Loader2,
	RadioTower,
	Terminal,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LiveSlot } from "@/components/shared/LiveSlot";
import { Mono } from "@/components/shared/Mono";
import { StateChip } from "@/components/shared/StateChip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/** One harness's last on-demand ACP handshake verdict, kept only in memory — it goes stale the moment the harness's login state changes. */
interface ProbeState {
	/** Only "answers ACP" is a pass; it still does not mean signed in. */
	answers: boolean;
	detail: string;
	timestamp: Date;
}

export function HarnessSettings() {
	const { data, isLoading, isError, refetch } = useHarnesses();
	const { data: settings, isLoading: settingsLoading } = useHarnessSettings();
	const updateSettings = useUpdateHarnessSettings();
	const checkHarness = useCheckHarness();

	const [selected, setSelected] = useState<HarnessSetting>("auto");
	const [model, setModel] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);
	const [probes, setProbes] = useState<Partial<Record<HarnessId, ProbeState>>>(
		{},
	);
	const [lastCheckedId, setLastCheckedId] = useState<HarnessId | null>(null);

	async function handleCheck(id: HarnessId) {
		setLastCheckedId(id);
		try {
			const result = await checkHarness.mutateAsync({ id });
			setProbes((prev) => ({
				...prev,
				[id]: {
					answers: result.outcome === "answers-acp",
					detail: result.detail,
					timestamp: new Date(),
				},
			}));
		} catch (err) {
			setProbes((prev) => ({
				...prev,
				[id]: {
					answers: false,
					detail:
						err instanceof Error ? err.message : "Could not run the check",
					timestamp: new Date(),
				},
			}));
		}
	}

	const savedHarness = settings?.harness ?? "auto";
	const savedModel = settings?.model ?? "";
	useEffect(() => {
		setSelected(savedHarness);
		setModel(savedModel);
	}, [savedHarness, savedModel]);

	const dirty = selected !== savedHarness || model !== savedModel;

	const harnesses = data?.harnesses ?? [];
	const selection = data?.selection;
	const effectiveHarness = selected === "auto" ? selection?.harness : selected;
	const effectiveHarnessStatus = harnesses.find(
		(h) => h.id === effectiveHarness,
	);
	const defaultModel = effectiveHarnessStatus?.defaultModel ?? null;
	const modelIgnored = effectiveHarnessStatus?.modelVia === "unsupported";

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
			<div
				className="rounded-lg border bg-card p-6 flex items-center justify-center py-12"
				data-testid="harness-settings"
			>
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	// Determine probe / readiness LiveSlot props
	const activeProbeId =
		lastCheckedId ??
		(effectiveHarness as HarnessId | null) ??
		(selection?.harness as HarnessId | null);
	const activeProbe = activeProbeId ? probes[activeProbeId] : undefined;
	const probeHarness = harnesses.find((h) => h.id === activeProbeId);

	let liveSlotProps: React.ComponentProps<typeof LiveSlot>;

	if (checkHarness.isPending) {
		liveSlotProps = {
			label: "Investigation agent",
			state: "fetching",
			source: probeHarness?.binary ?? "probing",
		};
	} else if (activeProbe && probeHarness) {
		if (activeProbe.answers) {
			liveSlotProps = {
				label: "Investigation agent",
				state: "live",
				value: `${probeHarness.label}${probeHarness.admission?.version ? ` ${probeHarness.admission.version}` : ""}`,
				source: probeHarness.binary,
				updatedAt: activeProbe.timestamp,
			};
		} else {
			liveSlotProps = {
				label: "Investigation agent",
				state: "failed",
				source: probeHarness.binary,
				reason: activeProbe.detail,
				onRetry: () => handleCheck(activeProbeId!),
			};
		}
	} else if (isError) {
		liveSlotProps = {
			label: "Investigation agent",
			state: "failed",
			source: "agent status",
			reason: "PrismaLens could not read the agent status on this machine.",
			onRetry: () => refetch(),
		};
	} else if (
		!selection?.runnable ||
		(harnesses.length > 0 && harnesses.every((h) => !h.installed))
	) {
		liveSlotProps = {
			label: "Investigation agent",
			state: "not-configured",
			reason:
				selection?.blockedReason ??
				harnesses[0]?.install ??
				"No coding agent found on PATH.",
			action: {
				label: "Docs",
				to: "https://docs.prismalens.io",
			},
		};
	} else {
		liveSlotProps = {
			label: "Investigation agent",
			state: "live",
			value: `${effectiveHarnessStatus?.label ?? selection?.harness ?? "Agent"}${effectiveHarnessStatus?.admission?.version ? ` ${effectiveHarnessStatus.admission.version}` : ""}`,
			source: effectiveHarnessStatus?.binary ?? "configured",
			updatedAt: new Date(),
		};
	}

	return (
		<div
			className="rounded-lg border bg-card p-6 space-y-4"
			data-testid="harness-settings"
		>
			<div className="space-y-1">
				<div className="flex items-center gap-2">
					<Terminal className="h-5 w-5 text-muted-foreground" />
					<h3 className="text-base font-semibold">Investigation agent</h3>
				</div>
				<p className="text-sm text-muted-foreground">
					The coding agent PrismaLens rents to do the investigative legwork. It
					authenticates on its own — a signed-in session counts, an API key is
					not always required.
				</p>
			</div>

			<LiveSlot {...liveSlotProps} className="my-2" />

			{isError && (
				<Alert data-testid="harness-status-error">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>Agent status unavailable</AlertTitle>
					<AlertDescription>
						PrismaLens could not read the agent status on this machine. You can
						still pick an agent; the badges below return once the check
						succeeds.
					</AlertDescription>
				</Alert>
			)}

			{!isError &&
				harnesses.length > 0 &&
				harnesses.every((h) => !h.installed) && (
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

			{selection?.pinned && selection.pinnedBy === "env" && (
				<Alert data-testid="harness-pinned-notice">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>PRISMALENS_HARNESS overrides this picker</AlertTitle>
					<AlertDescription>
						The environment variable is set on this machine, so it decides which
						harness runs regardless of what is saved here. Unset it to let this
						picker take effect.
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
					const harnessId = harness.id as HarnessId;
					const probe = probes[harnessId];
					const checking =
						checkHarness.isPending && checkHarness.variables?.id === harnessId;
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
									<Mono className="text-xs text-muted-foreground">
										{harness.binary}
									</Mono>
									{isSelected && <StateChip tone="active">Selected</StateChip>}
									<StateChip
										tone={harness.installed ? "done" : "neutral"}
										dashed={!harness.installed}
									>
										{harness.installed ? "Installed" : "Not installed"}
									</StateChip>
									{harness.admission ? (
										<StateChip
											tone="done"
											title={harness.admission.date}
											data-testid={`harness-admission-${harness.id}`}
										>
											{`CI-verified ${harness.admission.version}`}
										</StateChip>
									) : (
										<StateChip
											tone="neutral"
											dashed
											data-testid={`harness-admission-${harness.id}`}
										>
											Not admitted
										</StateChip>
									)}
								</div>
								{descriptor && (
									<p className="mt-1 text-xs text-muted-foreground">
										<span className="capitalize">
											{descriptor.readOnlyFidelity}
										</span>{" "}
										read-only
									</p>
								)}
								<p className="text-xs text-muted-foreground">
									Sign-in: {harness.loginHint}
								</p>
								{!harness.installed && (
									<p className="mt-1 text-xs text-muted-foreground">
										{harness.install}
									</p>
								)}
								{harness.installed && (
									<div className="mt-2 flex flex-wrap items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => handleCheck(harnessId)}
											disabled={checking}
											data-testid={`harness-check-${harness.id}`}
										>
											{checking ? (
												<Loader2 className="mr-2 h-3 w-3 animate-spin" />
											) : (
												<RadioTower className="mr-2 h-3 w-3" />
											)}
											Check readiness
										</Button>
										{probe && !checking && (
											<span
												className={cn(
													"text-xs",
													probe.answers
														? "text-muted-foreground"
														: "text-destructive",
												)}
												data-testid={`harness-check-result-${harness.id}`}
											>
												{probe.detail}
											</span>
										)}
									</div>
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
						placeholder={defaultModel ?? "harness default"}
						className="w-full sm:w-80"
						disabled={modelIgnored}
					/>
					<p className="text-xs text-muted-foreground">
						{modelIgnored ? (
							<>
								{effectiveHarnessStatus?.label} ignores the Model setting; it
								uses its own configured model.
							</>
						) : (
							<>
								Model id in the harness's own format.{" "}
								{defaultModel
									? `Empty means ${defaultModel}, the model prismalens verified for this harness.`
									: "Empty leaves the harness to its own default, which nobody verified."}
							</>
						)}
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
								: (HARNESS_REGISTRY[
										savedHarness as keyof typeof HARNESS_REGISTRY
									]?.label ?? savedHarness)}
							{savedModel ? ` (${savedModel})` : ""}.
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
