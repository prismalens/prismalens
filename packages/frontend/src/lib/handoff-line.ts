// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVEL_LABEL,
	type CanonicalEvent,
	type HandoffPreview,
} from "@prismalens/contracts";
import { formatClock } from "@/lib/format-time";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The hint line over a finished run's box: where the message goes, then what
 * a fresh session gets and what stays in the transcript file. `problem` is the
 * recipient's preflight refusal with its fix, for the line under the box.
 */
export function handoffHint(
	p: HandoffPreview,
	o: { agent: string; continues: boolean; reported: boolean; name: string },
): { where: string; what: string | null; problem: string | null } {
	const problem = p.preflight
		? `${p.preflight.problem} ${p.preflight.fix}`
		: null;
	const report = o.continues ? " and ends in a report on the overview" : "";
	if (p.route === "load")
		return {
			where: `Continues in ${o.agent}'s own session${report}.`,
			what: null,
			problem,
		};
	const level = p.accessLevel
		? `, at ${ACCESS_LEVEL_LABEL[p.accessLevel]}`
		: "";
	const left = p.omitted
		? o.reported
			? ` ${cap(p.omitted)} stay in the transcript file, which ${o.agent} can read.`
			: ` ${o.name} has no report; ${p.omitted} stay in the transcript file, which ${o.agent} can read.`
		: o.reported
			? ""
			: ` ${o.name} has no report.`;
	return {
		where: `Continues in a fresh ${o.agent} session${level}${o.continues ? "," : ""}${report}.`,
		what: `${o.agent} gets ${p.carried}.${left}`,
		problem,
	};
}

type Via = NonNullable<
	Extract<CanonicalEvent, { kind: "operator_message" }>["via"]
>;

/** The transcript's record of a handoff, in place of the "Resumed in the same session" divider. */
export function handoffRecord(
	via: Via & { handoff: NonNullable<Via["handoff"]> },
	at: string,
	names: { agent: (id: string) => string; model: (id: string) => string },
): string {
	const model = via.model ? `, ${names.model(via.model)}` : "";
	const from = via.handoff.from ? ` from ${names.agent(via.handoff.from)}` : "";
	return `${names.agent(via.harness)}${model}, took over${from} at ${formatClock(at)}, in a fresh session. It got ${via.handoff.carried}.`;
}

/** True once a follow-up went to a fresh session: earlier usage was another session's (ruling 13). */
export function handedOff(events: readonly CanonicalEvent[]): boolean {
	return events.some((e) => e.kind === "operator_message" && !!e.via?.handoff);
}
