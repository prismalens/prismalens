// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TermsRuns } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { agentFacts } from "@/lib/agent-facts";
import { StatePill, type Word } from "./source-words";

/** Which runs a sign-in path may start, as Settings says it (#1252). */
export const TERMS_WORD: Record<TermsRuns, Word> = {
	allowed: { text: "Alerts and schedules", tone: "ok" },
	"interactive-only": { text: "Your runs only", tone: "warn" },
	never: { text: "Not run by PrismaLens", tone: "danger" },
	unknown: { text: "Terms unread", tone: "neutral" },
};

/** Each of an agent's sign-in methods with its vendor's clause, and the one runs use here now. */
export function SignInPaths({ agent }: { agent: HarnessStatus }) {
	const methods = agentFacts(agent.id)?.signIn.methods ?? [];
	if (!methods.length) return null;
	const now = agent.authPath;
	return (
		<SettingGroup title="Sign-in" testId="agent-sign-in-paths">
			<Pool>
				{methods.map((m) => {
					const { source, against, gaps } = m.terms;
					return (
						<SettingRow
							key={m.id}
							label={m.label}
							testId={`agent-sign-in-${m.id}`}
							below={
								<p className="text-meta text-text-3">
									{now?.method === m.id
										? "Runs use this one here. "
										: now?.other === m.id
											? "Runs may use this one here. "
											: ""}
									“{source.clause}”{" "}
									<a
										href={source.url}
										target="_blank"
										rel="noreferrer"
										className="underline"
									>
										{new URL(source.url).hostname}
									</a>
									, read {source.readOn}.
									{against && ` Against it: “${against.clause}”`}
									{gaps?.length ? ` Not read: ${gaps.join("; ")}.` : ""}
								</p>
							}
						>
							<StatePill
								word={TERMS_WORD[m.terms.runs]}
								testId={`agent-sign-in-${m.id}-runs`}
							/>
						</SettingRow>
					);
				})}
			</Pool>
		</SettingGroup>
	);
}
