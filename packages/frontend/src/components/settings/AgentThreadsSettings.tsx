// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AgentsStartThreads,
	THREAD_TREE_DEFAULTS,
	type ThreadTreeSettings,
} from "@prismalens/contracts";
import { AdvancedFold } from "@/components/shared/AdvancedFold";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useOperator } from "@/hooks/use-operator";
import {
	useTreeSettings,
	useUpdateTreeSettings,
} from "@/lib/api/hooks/use-app-settings-orpc";

export const AGENTS_START_WORD: Record<AgentsStartThreads, string> = {
	ask: "Ask each time",
	allow: "Allowed within limits",
	never: "Never",
};

type Cap = "depth" | "children" | "perTree";

/** Each cap's bounds come from `ThreadTreeSettingsSchema`. */
const CAPS: {
	field: Cap;
	label: string;
	description: string;
	range: [number, number];
}[] = [
	{
		field: "depth",
		label: "Depth",
		description: "Levels below the first thread",
		range: [1, 5],
	},
	{
		field: "children",
		label: "Threads per thread",
		description: "Live at once",
		range: [1, 20],
	},
	{
		field: "perTree",
		label: "Threads per tree",
		description: "The first one included",
		range: [2, 50],
	},
];

const HOST_ONLY = "Only the computer running PrismaLens can change this.";

/** Agent → "Agents may start threads", with its caps folded under Advanced. */
export function AgentThreadsGroup() {
	const { data } = useTreeSettings();
	const update = useUpdateTreeSettings();
	const { managesPairing: host } = useOperator();
	const settings: ThreadTreeSettings = data ?? THREAD_TREE_DEFAULTS;
	const disabled = !data || update.isPending || !host;
	return (
		<>
			<SettingGroup title="Threads agents start" testId="agent-threads">
				<Pool>
					<SettingRow
						label={
							<span id="agent-threads-start-label">
								Agents may start threads
							</span>
						}
						description={host ? "Each new thread runs on its own" : HOST_ONLY}
						testId="agent-threads-start-row"
					>
						<Select
							value={settings.agentsStartThreads}
							onValueChange={(v) =>
								update.mutate({ agentsStartThreads: v as AgentsStartThreads })
							}
							disabled={disabled}
						>
							<SelectTrigger
								aria-labelledby="agent-threads-start-label"
								className="w-48"
								data-testid="agent-threads-start"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(Object.keys(AGENTS_START_WORD) as AgentsStartThreads[]).map(
									(k) => (
										<SelectItem key={k} value={k}>
											{AGENTS_START_WORD[k]}
										</SelectItem>
									),
								)}
							</SelectContent>
						</Select>
					</SettingRow>
				</Pool>
			</SettingGroup>
			<AdvancedFold
				testId="agent-threads-advanced"
				label="Thread limits"
				description="How far threads that agents start may branch"
			>
				<Pool>
					{CAPS.map((cap) => (
						<SettingRow
							key={cap.field}
							label={
								<span id={`agent-threads-${cap.field}-label`}>{cap.label}</span>
							}
							description={cap.description}
							testId={`agent-threads-${cap.field}-row`}
						>
							<Select
								value={String(settings[cap.field])}
								onValueChange={(v) => update.mutate({ [cap.field]: Number(v) })}
								disabled={disabled}
							>
								<SelectTrigger
									aria-labelledby={`agent-threads-${cap.field}-label`}
									className="w-24"
									data-testid={`agent-threads-${cap.field}`}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{range(cap.range).map((n) => (
										<SelectItem key={n} value={String(n)}>
											{n}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SettingRow>
					))}
				</Pool>
			</AdvancedFold>
		</>
	);
}

const range = ([lo, hi]: [number, number]) =>
	Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
