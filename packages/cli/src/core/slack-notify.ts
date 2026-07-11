// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ConductedOutcome } from "@prismalens/engine";

export function buildSlackMessage(input: {
	alertname: string;
	runId: string;
	outcome: ConductedOutcome;
}): string {
	const { alertname, runId, outcome } = input;

	if (outcome.failureKind === "cancelled") {
		return "";
	}

	if (outcome.failureKind === "error") {
		return `${alertname}\nInvestigation errored: ${outcome.error ?? "unknown error"}\nRun ${runId} — pl report ${runId}`;
	}

	if (outcome.failureKind === "no-evidence") {
		return `${alertname}\nInvestigated — insufficient evidence to determine a cause.\nRun ${runId} — pl report ${runId}`;
	}

	const report = outcome.report;
	if (!report) {
		return "";
	}

	let message = `${alertname}\n${report.summary}\nRoot cause: ${report.rootCause ?? "not determined"}`;

	if (report.hypotheses.length > 0) {
		const topHypothesis = report.hypotheses[0];
		message += `\nTop hypothesis: ${topHypothesis.statement} (${topHypothesis.evidence.length} evidence)`;
	}

	message += `\nRun ${runId} — pl report ${runId}`;

	return message;
}

export async function postToSlack(
	webhookUrl: string,
	text: string,
): Promise<void> {
	const res = await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(5000),
	});

	if (!res.ok) {
		throw new Error(`Slack webhook returned ${res.status}`);
	}
}

export async function notifyRun(
	webhookUrl: string,
	alertname: string,
	outcome: ConductedOutcome,
): Promise<void> {
	try {
		const text = buildSlackMessage({
			alertname,
			runId: outcome.runId,
			outcome,
		});
		if (!text) {
			return;
		}
		await postToSlack(webhookUrl, text);
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "slack_delivery_failed",
				runId: outcome.runId,
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	}
}
