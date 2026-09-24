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

import type { HarnessId } from "@prismalens/config/harness";
import { AlertTriangle, Loader2, RadioTower } from "lucide-react";
import { useState } from "react";
import { AgentPicker, useAgentChoice } from "@/components/agent/AgentPicker";
import { RunToolbar } from "@/components/agent/RunToolbar";
import { Mono } from "@/components/shared/Mono";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { StateWord } from "@/components/shared/StateChip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
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
	const { isLoading: settingsLoading } = useHarnessSettings();
	const { effective } = useAgentChoice();
	const checkHarness = useCheckHarness();
	const [probes, setProbes] = useState<Partial<Record<HarnessId, ProbeState>>>(
		{},
	);

	async function handleCheck(id: HarnessId) {
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

	const harnesses = data?.harnesses ?? [];
	const selection = data?.selection;

	if (isLoading || settingsLoading) {
		return (
			<div
				className="flex items-center justify-center py-12"
				data-testid="harness-settings"
			>
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6" data-testid="harness-settings">
			{isError && (
				<Alert data-testid="harness-status-error">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>Agent status unavailable</AlertTitle>
					<AlertDescription>
						PrismaLens could not read the agent status on this machine.{" "}
						<button
							type="button"
							className="underline"
							onClick={() => refetch()}
						>
							Try again
						</button>
					</AlertDescription>
				</Alert>
			)}
			{!isError &&
				harnesses.length > 0 &&
				harnesses.every((h) => !h.installed) && (
					<Alert data-testid="harness-none-available">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>No investigation agent is on this machine</AlertTitle>
						<AlertDescription>
							Runs cannot start until one of the agents below is installed.
						</AlertDescription>
					</Alert>
				)}
			{selection?.pinned && selection.pinnedBy === "env" && (
				<Alert data-testid="harness-pinned-notice">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>PRISMALENS_HARNESS overrides this choice</AlertTitle>
					<AlertDescription>
						The environment variable decides which agent runs on this machine.
						Unset it to let the choice here take effect.
					</AlertDescription>
				</Alert>
			)}

			<SettingGroup
				title="Runs"
				description="What the next investigation starts with. The same controls sit under the composer on a record."
			>
				<SettingRow
					label="Agent and model"
					description="Auto takes the first agent on PATH."
					testId="harness-run-row"
				>
					<RunToolbar />
				</SettingRow>
				<SettingRow
					label="Next run"
					description={
						selection?.runnable
							? `Would start with ${effective?.label ?? selection.harness}.`
							: (selection?.blockedReason ?? "Would not start right now.")
					}
					testId="harness-selection"
				>
					{selection?.runnable ? (
						<StateWord tone="done">ready</StateWord>
					) : (
						<StateWord tone="failed">blocked</StateWord>
					)}
				</SettingRow>
			</SettingGroup>

			<SettingGroup
				title="Agents on this machine"
				description="Installed means the binary is on PATH; tested means CI ran an investigation through that version. Each agent runs with its own behaviour and permissions, as it would in your terminal."
				testId="harness-registry"
			>
				{harnesses.map((harness) => {
					const harnessId = harness.id as HarnessId;
					const probe = probes[harnessId];
					const checking =
						checkHarness.isPending && checkHarness.variables?.id === harnessId;
					const isSelected = selection?.harness === harness.id;
					return (
						<SettingRow
							key={harness.id}
							label={
								<span className="flex items-center gap-2">
									{harness.label}
									<Mono className="text-meta font-normal text-muted-foreground">
										{harness.binary}
									</Mono>
									{isSelected && <StateWord tone="live">in use</StateWord>}
								</span>
							}
							description={
								<span className="flex flex-wrap items-center gap-x-2">
									{harness.installed ? (
										<StateWord tone="done">installed</StateWord>
									) : (
										<StateWord tone="neutral">not installed</StateWord>
									)}
									{harness.tested && (
										<StateWord
											tone="neutral"
											title={harness.tested.date}
											data-testid={`harness-tested-${harness.id}`}
										>
											tested {harness.tested.version}
										</StateWord>
									)}
									<span>
										· {harness.installed ? harness.loginHint : harness.install}
									</span>
								</span>
							}
							below={
								probe && !checking ? (
									<p
										className={cn(
											"text-meta",
											probe.answers
												? "text-muted-foreground"
												: "text-run-failed",
										)}
										data-testid={`harness-check-result-${harness.id}`}
									>
										{probe.detail}
									</p>
								) : undefined
							}
						>
							{harness.installed && (
								<Button
									variant="outline"
									size="sm"
									className="h-7"
									onClick={() => handleCheck(harnessId)}
									disabled={checking}
									data-testid={`harness-check-${harness.id}`}
								>
									{checking ? (
										<Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
									) : (
										<RadioTower className="mr-1.5 h-3 w-3" />
									)}
									Check readiness
								</Button>
							)}
						</SettingRow>
					);
				})}
			</SettingGroup>
		</div>
	);
}
