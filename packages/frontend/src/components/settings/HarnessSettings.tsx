// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Settings → Agent (#337/#609 narrowing of #501/ADR-0031).
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
import type { HarnessStatus } from "@prismalens/contracts";
import { useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import {
	AgentModelPicker,
	BOUNDARY_NOTE,
	READ_ONLY_LINE,
} from "@/components/agent/AgentPicker";
import { InlineCode } from "@/components/shared/InlineCode";
import { Mono } from "@/components/shared/Mono";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
		return <div data-testid="harness-settings" />;
	}

	return (
		<div data-testid="harness-settings">
			{isError && (
				<p
					className="mb-4 text-body text-danger"
					data-testid="harness-status-error"
				>
					PrismaLens could not read the agent status on this machine.{" "}
					<button type="button" className="underline" onClick={() => refetch()}>
						Try again
					</button>
				</p>
			)}
			{selection?.pinned && selection.pinnedBy === "env" && (
				<p
					className="mb-4 text-body text-warn"
					data-testid="harness-pinned-notice"
				>
					PRISMALENS_HARNESS decides which agent runs on this machine; unset it
					to let the choice here take effect.
				</p>
			)}

			<SettingGroup title="Next run">
				<SettingRow
					label="Agent and model"
					description={
						selection?.runnable === false
							? (selection.blockedReason ?? "Would not start right now.")
							: "The same control sits in the box on an incident."
					}
					testId="harness-run-row"
				>
					<AgentModelPicker />
				</SettingRow>
				<SettingRow
					label="Access level"
					description={`${READ_ONLY_LINE} ${BOUNDARY_NOTE}`}
					testId="harness-access"
				>
					<span className="text-body text-text-2">
						Read-only, chosen per run in the box
					</span>
				</SettingRow>
				<SettingRow
					label="Allow write levels"
					description="Edit the copy writes inside the run's throwaway clone. Full access lets the agent do anything on this machine."
					testId="harness-allow-write"
				>
					<Switch
						checked={settings?.allowWriteLevels === true}
						onCheckedChange={(on) =>
							updateSettings.mutate({ allowWriteLevels: on })
						}
						aria-label="Allow write levels"
						data-testid="harness-allow-write-switch"
					/>
				</SettingRow>
			</SettingGroup>

			<SettingGroup title="Agents on this machine" testId="harness-registry">
				{harnesses.length > 0 && harnesses.every((h) => !h.installed) && (
					<p
						className="pb-2 text-body text-text-2"
						data-testid="harness-none-available"
					>
						None found on PATH. Runs start once one of these is installed.
					</p>
				)}
				{harnesses.map((harness) => {
					const harnessId = harness.id as HarnessId;
					const probe = probes[harnessId];
					const checking =
						checkHarness.isPending && checkHarness.variables?.id === harnessId;
					const inUse = selection?.harness === harness.id;
					return (
						<SettingRow
							key={harness.id}
							testId={`harness-row-${harness.id}`}
							label={
								<span className="flex flex-wrap items-baseline gap-x-2">
									<AgentMark id={harness.id} className="relative top-0.5" />
									{harness.label}
									{harness.installed ? (
										harness.tested && (
											<span
												className="text-meta text-text-3"
												title={harness.tested.date}
												data-testid={`harness-tested-${harness.id}`}
											>
												{harness.tested.version}
											</span>
										)
									) : (
										<span className="text-text-3">not installed</span>
									)}
									{inUse && (
										<span className="text-meta font-medium text-ok">
											in use
										</span>
									)}
								</span>
							}
							description={
								harness.installed ? (
									<>
										{capabilities(harness)}{" "}
										<InlineCode text={harness.loginHint} />
									</>
								) : (
									<Mono className="break-all">{harness.install}</Mono>
								)
							}
							below={
								probe && !checking ? (
									<p
										className={cn(
											"text-meta",
											probe.answers ? "text-text-3" : "text-danger",
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
									variant="ghost"
									size="sm"
									onClick={() => handleCheck(harnessId)}
									disabled={checking}
									data-testid={`harness-check-${harness.id}`}
								>
									{checking ? "Checking" : "Check"}
								</Button>
							)}
						</SettingRow>
					);
				})}
			</SettingGroup>
		</div>
	);
}

/** What the agent takes from PrismaLens, as the last check read it (r4 R4.1 rev, R4.2, R4.3). */
function capabilities(h: HarnessStatus): string {
	const model =
		h.modelVia === "acp"
			? "Takes a model over ACP."
			: h.id === "deepagents"
				? "Uses its own model."
				: "Model: pending a check.";
	const effort = h.checked?.effort
		? ` Effort over ACP: ${h.checked.effort.values.join(", ")}.`
		: "";
	const images = h.checked
		? ` Images: ${h.checked.images ? "yes" : "no"}.`
		: " Images: not checked yet.";
	return `${model}${effort}${images}`;
}
