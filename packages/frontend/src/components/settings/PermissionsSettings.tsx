// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVELS,
	type AccessLevel,
	type HarnessId,
} from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	ACCESS_LEVEL_LINE,
	type EnforcementRow,
	type HarnessStatus,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import {
	defaultAccessOf,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { settingOf } from "@/components/kit/registry";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { agentNote, permissionLine } from "@/lib/access-levels";
import { useUpdateHarnessSettings } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import {
	AlertAsksRow,
	AxisSelect,
	LEVEL_OPTIONS,
	UnattendedGithubRow,
} from "./HarnessSettings";
import { RiskConfirm } from "./RiskConfirm";

/** The one level whose risk the row states and a second confirm guards. */
const DANGEROUS: AccessLevel = "full-access";
const FULL_ACCESS_RISK =
	"Risk: nothing asks first; the agent can delete files, push and run any command as you.";

const FIDELITY_WORD: Record<EnforcementRow["fidelity"], string> = {
	enforced: "enforced by its sandbox",
	cooperative: "held by the agent's own mode",
	advisory: "asked of the agent, not enforced",
};

/** Settings → Permissions (#1101 cat 18): the ladder, each agent's default and what alert runs do. */
export function PermissionsSettings() {
	const { harnesses } = useAgentChoice();
	const enforcement = useQuery(
		orpc.usage.enforcement.queryOptions({ input: {} }),
	);
	const rows = enforcement.data?.rows ?? [];
	const label = (id: string) => harnesses.find((h) => h.id === id)?.label ?? id;
	const listed = harnesses.filter((h) => h.runnable);
	return (
		<div data-testid="permissions-settings">
			<SettingGroup
				title={settingOf("permissions.permissionLevels").label}
				description={settingOf("permissions.permissionLevels").sentence}
				testId={settingOf("permissions.permissionLevels").anchor}
			>
				<Pool>
					{ACCESS_LEVELS.map((level) => {
						const seen = rows.filter((r) => r.access === level);
						return (
							<SettingRow
								key={level}
								label={ACCESS_LEVEL_LABEL[level]}
								description={
									<>
										{ACCESS_LEVEL_LINE[level]}
										{level === DANGEROUS && (
											<span className="block text-warn">
												{FULL_ACCESS_RISK}
											</span>
										)}
										{seen.map((r) => (
											<span
												key={r.agent}
												className="block text-text-3"
												data-testid={`permissions-enforced-${level}-${r.agent}`}
											>
												{label(r.agent)}: {FIDELITY_WORD[r.fidelity]}, {r.runs}{" "}
												{r.runs === 1 ? "run" : "runs"}
											</span>
										))}
									</>
								}
								testId={`permissions-level-${level}`}
							/>
						);
					})}
				</Pool>
			</SettingGroup>

			<SettingGroup
				title={settingOf("permissions.defaultPermissionPerAgent").label}
				description={
					settingOf("permissions.defaultPermissionPerAgent").sentence
				}
				testId={settingOf("permissions.defaultPermissionPerAgent").anchor}
			>
				{listed.length === 0 ? (
					<p className="text-body text-text-2">No agent can run.</p>
				) : (
					<Pool>
						{listed.map((h) => (
							<AgentLevelRow key={h.id} harness={h} />
						))}
					</Pool>
				)}
			</SettingGroup>

			<SettingGroup title="Alert runs" testId="permissions-alert-runs">
				<Pool>
					<SettingRow
						label="Level"
						description="Auto: nobody is there to answer, so an alert run never asks for more"
						testId="permissions-alert-level"
					>
						<span className="text-meta text-text-3">Auto</span>
					</SettingRow>
					<AlertAsksRow />
					<UnattendedGithubRow />
				</Pool>
			</SettingGroup>
		</div>
	);
}

/** One agent's default level; Full access states its risk and asks again before it saves. */
function AgentLevelRow({ harness }: { harness: HarnessStatus }) {
	const { axes } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const [asking, setAsking] = useState(false);
	const id = harness.id as HarnessId;
	const set = axes.accessLevels[id];
	const value = set ?? defaultAccessOf(harness, axes).level.level;
	const note = agentNote(harness);
	return (
		<SettingRow
			label={
				<span className="flex items-center gap-2">
					<AgentMark id={harness.id} className="size-4" />
					{harness.label}
				</span>
			}
			description={
				<>
					{permissionLine(harness, set)}
					{value === DANGEROUS && (
						<span className="block text-warn">{FULL_ACCESS_RISK}</span>
					)}
					{note && <span className="block text-text-3">{note}</span>}
				</>
			}
			testId={`permissions-agent-${harness.id}`}
			changed={!!set}
			onReset={() => update.mutate({ accessLevels: { [id]: null } })}
		>
			<AxisSelect
				value={value}
				options={LEVEL_OPTIONS}
				label={`Permission for ${harness.label}`}
				testId={`permissions-agent-${harness.id}`}
				onChange={(v) =>
					v === DANGEROUS
						? setAsking(true)
						: update.mutate({ accessLevels: { [id]: v } })
				}
			/>
			<RiskConfirm
				open={asking}
				onOpenChange={setAsking}
				title={`Give ${harness.label} full access?`}
				risk="Every ask is approved without you. The agent can delete files, push and run any command your user can."
				confirmLabel="Give full access"
				onConfirm={() => update.mutate({ accessLevels: { [id]: DANGEROUS } })}
				testId="permissions-full-access-confirm"
			/>
		</SettingRow>
	);
}
