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
 * `GET`/`PATCH /settings/harness`: the persisted choice and model. That
 * persisted choice loses to `PRISMALENS_HARNESS` when the env var is set
 * (`selection.pinned`), so the picker stays editable but the page says so.
 */

import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessProbeResult, HarnessStatus } from "@prismalens/contracts";
import { useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import {
	AgentModelPicker,
	BOUNDARY_NOTE,
	READ_ONLY_LINE,
} from "@/components/agent/AgentPicker";
import { Hint } from "@/components/shared/Hint";
import { InlineCode } from "@/components/shared/InlineCode";
import { Mono } from "@/components/shared/Mono";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import { type StateTone, StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";

/** One harness's last on-demand ACP handshake verdict, kept only in memory; it goes stale the moment the harness's login state changes. */
interface ProbeState {
	/** Only "answers ACP" is a pass; it still does not mean signed in. */
	outcome: HarnessProbeResult["outcome"];
	detail: string;
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
				[id]: { outcome: result.outcome, detail: result.detail },
			}));
		} catch (err) {
			setProbes((prev) => ({
				...prev,
				[id]: {
					outcome: "failed-to-start",
					detail: "The check did not run. Try it again.",
				},
			}));
		}
	}

	const harnesses = data?.harnesses ?? [];
	const selection = data?.selection;

	if (isLoading || settingsLoading) {
		return (
			<div data-testid="harness-settings">
				<Loading rows={5} />
			</div>
		);
	}

	return (
		<div data-testid="harness-settings">
			{isError && (
				<div className="mb-4" data-testid="harness-status-error">
					<Problem
						text="PrismaLens could not read the agent status on this machine."
						onRetry={() => refetch()}
					/>
				</div>
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
				<Pool>
					<SettingRow
						label="Agent and model"
						description={
							selection?.runnable === false
								? (selection.blockedReason ?? "Would not start right now.")
								: "The same control sits in the box on an incident"
						}
						testId="harness-run-row"
					>
						<AgentModelPicker />
					</SettingRow>
					<SettingRow
						label="Access level"
						description={
							<Hint label={READ_ONLY_LINE} meta={BOUNDARY_NOTE} side="top">
								<span>
									Every run starts read-only; the box raises it for one run
								</span>
							</Hint>
						}
						testId="harness-access"
					>
						<span className="text-body font-medium text-text-1">Read-only</span>
					</SettingRow>
					<SettingRow
						label={
							<label htmlFor="harness-allow-write">Allow write levels</label>
						}
						description="Edit the copy and Full access appear in the box once this is on"
						testId="harness-allow-write"
					>
						<Switch
							id="harness-allow-write"
							checked={settings?.allowWriteLevels === true}
							onCheckedChange={(on) =>
								updateSettings.mutate({ allowWriteLevels: on })
							}
							aria-label="Allow write levels"
							data-testid="harness-allow-write-switch"
						/>
					</SettingRow>
				</Pool>
			</SettingGroup>

			<SettingGroup
				title="Agents on this machine"
				count={harnesses.length || undefined}
				testId="harness-registry"
				description={
					harnesses.length > 0 && harnesses.every((h) => !h.installed) ? (
						<span data-testid="harness-none-available">
							None found on PATH. Runs start once one of these is installed.
						</span>
					) : undefined
				}
			>
				<Pool>
					{harnesses.map((harness) => {
						const harnessId = harness.id as HarnessId;
						const probe = probes[harnessId];
						const checking =
							checkHarness.isPending &&
							checkHarness.variables?.id === harnessId;
						const inUse = selection?.harness === harness.id;
						return (
							<Row
								key={harness.id}
								testId={`harness-row-${harness.id}`}
								lead={<AgentMark id={harness.id} />}
								label={
									<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
										{harness.label}
										{harness.installed ? (
											harness.tested && (
												<Hint
													label={`Tested with ${harness.tested.version}`}
													meta={harness.tested.date}
												>
													<span
														className="font-mono text-meta text-text-3"
														data-testid={`harness-tested-${harness.id}`}
													>
														{harness.tested.version}
													</span>
												</Hint>
											)
										) : (
											<StateWord tone="quiet">not installed</StateWord>
										)}
										{inUse && <StateWord tone="ok">in use</StateWord>}
									</span>
								}
								meta={
									probe && !checking ? (
										<StateWord
											tone={PROBE_TONE[probe.outcome]}
											className="whitespace-normal"
											data-testid={`harness-check-result-${harness.id}`}
										>
											{probe.detail}
										</StateWord>
									) : harness.installed ? (
										<span className="[&_code]:bg-transparent [&_code]:p-0">
											{capabilities(harness)}{" "}
											<InlineCode text={harness.loginHint} />
										</span>
									) : (
										<Mono>{harness.install}</Mono>
									)
								}
								trailing={
									harness.installed && (
										<Button
											variant="text"
											size="sm"
											onClick={() => handleCheck(harnessId)}
											disabled={checking}
											data-testid={`harness-check-${harness.id}`}
										>
											{checking ? "Checking" : "Check"}
										</Button>
									)
								}
							/>
						);
					})}
				</Pool>
			</SettingGroup>
		</div>
	);
}

/** A check's verdict as a word (look ruling §1.3, agent row). */
const PROBE_TONE: Record<HarnessProbeResult["outcome"], StateTone> = {
	"answers-acp": "ok",
	"sign-in-needed": "warn",
	"no-answer": "danger",
	"failed-to-start": "danger",
};

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
