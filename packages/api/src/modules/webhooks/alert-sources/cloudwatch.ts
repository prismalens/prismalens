// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Severity } from "../../../shared/enums/index.js";
import type { AlertMapper } from "./types.js";
import { asObject, first, labelsOf } from "./util.js";

/** The Subscribe URL SNS hands over is fetched only when it points at SNS itself. */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isSnsSubscribeUrl(raw: string): boolean {
	try {
		const url = new URL(raw);
		return url.protocol === "https:" && SNS_HOST.test(url.hostname);
	} catch {
		return false;
	}
}

/**
 * Confirm an SNS HTTPS subscription by GETting its SubscribeURL. Returns false,
 * without a request, for a URL that is not an SNS endpoint, so a forged
 * handshake cannot make this host fetch an arbitrary address.
 */
export async function confirmSnsSubscription(
	subscribeUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	if (!isSnsSubscribeUrl(subscribeUrl)) return false;
	const res = await fetchImpl(subscribeUrl, {
		signal: AbortSignal.timeout(5_000),
	});
	return res.ok;
}

/** CloudWatch alarm state change, delivered inside an SNS `Notification` envelope. */
export const mapCloudWatch: AlertMapper = (payload) => {
	if (payload.Type !== "Notification" || typeof payload.Message !== "string") {
		return [];
	}
	let alarm: Record<string, unknown>;
	try {
		alarm = asObject(JSON.parse(payload.Message));
	} catch {
		return [];
	}
	const name = first(alarm.AlarmName);
	const state = first(alarm.NewStateValue);
	if (!name || (state !== "ALARM" && state !== "OK")) return [];

	// arn:aws:cloudwatch:<region>:<account>:alarm:<name>
	const arn = first(alarm.AlarmArn);
	const region = arn?.split(":")[3];
	const trigger = asObject(alarm.Trigger);
	const dimensions = Array.isArray(trigger.Dimensions)
		? trigger.Dimensions
		: [];
	const labels = labelsOf({
		alertname: name,
		account: first(alarm.AWSAccountId),
		region,
		namespace: first(trigger.Namespace),
		metric: first(trigger.MetricName),
	});
	for (const d of dimensions) {
		const dim = asObject(d);
		const dimName = first(dim.name, dim.Name);
		const dimValue = first(dim.value, dim.Value);
		if (!dimName || !dimValue) continue;
		labels[dimName === "ServiceName" ? "service" : `dim_${dimName}`] = dimValue;
	}

	return [
		{
			kind: state === "OK" ? "resolved" : "firing",
			dedupKey: arn ?? `${region ?? ""}:${name}`,
			title: name,
			description: [first(alarm.AlarmDescription), first(alarm.NewStateReason)]
				.filter(Boolean)
				.join("\n"),
			severity: Severity.high,
			sourceUrl: region
				? `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(name)}`
				: undefined,
			labels,
			raw: payload,
		},
	];
};
