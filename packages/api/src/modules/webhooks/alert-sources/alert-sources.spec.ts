// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Severity } from "../../../shared/enums/index.js";
import { confirmSnsSubscription, isSnsSubscribeUrl } from "./cloudwatch.js";
import * as azure from "./__fixtures__/azure-monitor.js";
import * as cloudwatch from "./__fixtures__/cloudwatch.js";
import * as datadog from "./__fixtures__/datadog.js";
import * as grafana from "./__fixtures__/grafana.js";
import * as newrelic from "./__fixtures__/newrelic.js";
import * as pagerduty from "./__fixtures__/pagerduty.js";
import * as sentry from "./__fixtures__/sentry.js";
import { ALERT_MAPPERS } from "./index.js";
import { verifyPagerDutySignature, verifySentrySignature } from "./signatures.js";

const map = ALERT_MAPPERS;

describe("Grafana", () => {
	it("maps a firing instance to its fingerprint, labels and severity", () => {
		const [a] = map.grafana(grafana.firing);
		expect(a).toMatchObject({
			kind: "firing",
			dedupKey: "c6eadffa33fcdf37",
			title: "High memory usage",
			severity: Severity.critical,
			description: "The system has high memory usage",
			sourceUrl: "https://play.grafana.org/alerting/1afz29v7z/edit",
		});
		expect(a.labels).toMatchObject({ service: "checkout", zone: "us-1" });
	});

	it("keeps the same identity when it resolves, so the resolve finds the firing", () => {
		expect(map.grafana(grafana.resolved)[0]).toMatchObject({
			kind: "resolved",
			dedupKey: "c6eadffa33fcdf37",
		});
	});

	it("ignores a body with no alerts", () => {
		expect(map.grafana({})).toEqual([]);
	});
});

describe("Datadog", () => {
	it("maps a trigger, stripping the [Triggered on ...] prefix and reading service from tags", () => {
		const [a] = map.datadog(datadog.firing);
		expect(a).toMatchObject({
			kind: "firing",
			dedupKey: "1234567:host:web-1",
			title: "CPU high on web-1",
			severity: Severity.high,
		});
		expect(a.labels).toMatchObject({ service: "checkout", env: "prod" });
	});

	it("gives the recovery the same key and the same labels", () => {
		const [fired] = map.datadog(datadog.firing);
		const [recovered] = map.datadog(datadog.resolved);
		expect(recovered.kind).toBe("resolved");
		expect(recovered.dedupKey).toBe(fired.dedupKey);
		expect(recovered.labels).toEqual(fired.labels);
	});

	it("ignores a body with no monitor id", () => {
		expect(map.datadog({ title: "x" })).toEqual([]);
	});
});

describe("Sentry", () => {
	it("maps an issue alert by issue id, with level, project and tags", () => {
		const [a] = map.sentry(sentry.issueAlert);
		expect(a).toMatchObject({
			kind: "firing",
			dedupKey: "issue:1234567890",
			title: "ReferenceError: heck is not defined",
			severity: Severity.high,
		});
		expect(a.labels).toMatchObject({ service: "checkout", environment: "prod" });
	});

	it("resolves the same issue from the issue webhook", () => {
		expect(map.sentry(sentry.issueResolved)[0]).toMatchObject({
			kind: "resolved",
			dedupKey: "issue:1234567890",
		});
	});

	it("maps a metric alert by rule and resolves it", () => {
		expect(map.sentry(sentry.metricAlert)[0]).toMatchObject({
			kind: "firing",
			dedupKey: "metric:7",
			severity: Severity.critical,
		});
		expect(map.sentry(sentry.metricResolved)[0].kind).toBe("resolved");
	});

	it("ignores issue actions that change no state here", () => {
		expect(
			map.sentry({ action: "assigned", data: { issue: { id: "1" } } }),
		).toEqual([]);
	});
});

describe("PagerDuty", () => {
	it("maps a triggered incident with priority, service and team", () => {
		const [a] = map.pagerduty(pagerduty.triggered);
		expect(a).toMatchObject({
			kind: "firing",
			dedupKey: "PGR0VU2",
			title: "A little bump in the road",
			severity: Severity.critical,
		});
		expect(a.labels).toMatchObject({
			service: "API Service",
			team: "Engineering",
		});
	});

	it("resolves by the same incident id and ignores an acknowledge", () => {
		expect(map.pagerduty(pagerduty.resolved)[0]).toMatchObject({
			kind: "resolved",
			dedupKey: "PGR0VU2",
		});
		expect(map.pagerduty(pagerduty.acknowledged)).toEqual([]);
	});
});

describe("CloudWatch through SNS", () => {
	it("maps an ALARM notification, reading the service from the ServiceName dimension", () => {
		const [a] = map.cloudwatch(cloudwatch.firing);
		expect(a).toMatchObject({
			kind: "firing",
			dedupKey:
				"arn:aws:cloudwatch:us-east-1:123456789012:alarm:checkout-5xx-rate",
			title: "checkout-5xx-rate",
			severity: Severity.high,
		});
		expect(a.labels).toMatchObject({ service: "checkout", region: "us-east-1" });
	});

	it("resolves on OK with the same key", () => {
		expect(map.cloudwatch(cloudwatch.resolved)[0]).toMatchObject({
			kind: "resolved",
			dedupKey:
				"arn:aws:cloudwatch:us-east-1:123456789012:alarm:checkout-5xx-rate",
		});
	});

	it("takes no alert from the handshake or from a non-alarm message", () => {
		expect(map.cloudwatch(cloudwatch.subscriptionConfirmation)).toEqual([]);
		expect(
			map.cloudwatch({ ...cloudwatch.firing, Message: "not json" }),
		).toEqual([]);
	});

	it("confirms a subscription only against an SNS endpoint", async () => {
		const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
		const url = cloudwatch.subscriptionConfirmation.SubscribeURL;
		expect(await confirmSnsSubscription(url, fetchImpl)).toBe(true);
		expect(fetchImpl).toHaveBeenCalledOnce();

		for (const bad of [
			"http://sns.us-east-1.amazonaws.com/?x=1",
			"https://sns.us-east-1.amazonaws.com.evil.test/?x=1",
			"https://169.254.169.254/latest/meta-data",
			"not a url",
		]) {
			expect(isSnsSubscribeUrl(bad)).toBe(false);
			expect(await confirmSnsSubscription(bad, fetchImpl)).toBe(false);
		}
		expect(fetchImpl).toHaveBeenCalledOnce();
	});
});

describe("Azure Monitor", () => {
	it("maps a fired common-schema alert", () => {
		const [a] = map["azure-monitor"](azure.firing);
		expect(a).toMatchObject({
			kind: "firing",
			title: "WCUS-R2-Gen2",
			severity: Severity.high,
		});
		expect(a.labels).toMatchObject({
			service: "checkout",
			resource: "wcus-r2-gen2",
			resource_group: "pipelinealertrg",
		});
	});

	it("resolves by the same alert id", () => {
		const [fired] = map["azure-monitor"](azure.firing);
		const [resolved] = map["azure-monitor"](azure.resolved);
		expect(resolved.kind).toBe("resolved");
		expect(resolved.dedupKey).toBe(fired.dedupKey);
		expect(resolved.labels).toEqual(fired.labels);
	});
});

describe("New Relic", () => {
	it("maps a workflow issue with priority, condition and tagged service", () => {
		const [a] = map.newrelic(newrelic.firing);
		expect(a).toMatchObject({
			kind: "firing",
			dedupKey: `issue:${newrelic.firing.issueId}`,
			title: "High error rate on checkout",
			severity: Severity.critical,
		});
		expect(a.labels).toMatchObject({
			alertname: "Error rate above 5%",
			service: "checkout",
			entity: "checkout-api",
		});
	});

	it("resolves on CLOSED, ignores ACKNOWLEDGED", () => {
		expect(map.newrelic(newrelic.resolved)[0].kind).toBe("resolved");
		expect(map.newrelic(newrelic.acknowledged)).toEqual([]);
	});

	it("reads the classic incident payload", () => {
		expect(map.newrelic(newrelic.classicOpen)[0]).toMatchObject({
			kind: "firing",
			dedupKey: "incident:42",
			title: "Apdex low",
			severity: Severity.critical,
		});
		expect(map.newrelic(newrelic.classicClosed)[0].kind).toBe("resolved");
	});
});

describe("vendor signatures", () => {
	const secret = "s".repeat(32);
	const body = Buffer.from(JSON.stringify(sentry.issueAlert));
	const digest = createHmac("sha256", secret).update(body).digest("hex");

	it("accepts a Sentry signature made with the secret and refuses a wrong or missing one", () => {
		expect(verifySentrySignature(secret, body, digest)).toBe(true);
		expect(verifySentrySignature(secret, body, "0".repeat(64))).toBe(false);
		expect(verifySentrySignature("other".repeat(8), body, digest)).toBe(false);
		expect(verifySentrySignature(secret, body, undefined)).toBe(false);
	});

	it("accepts any one v1 entry of a PagerDuty signature header", () => {
		expect(verifyPagerDutySignature(secret, body, `v1=${digest}`)).toBe(true);
		expect(
			verifyPagerDutySignature(secret, body, `v1=${"0".repeat(64)},v1=${digest}`),
		).toBe(true);
		expect(verifyPagerDutySignature(secret, body, `v1=${"0".repeat(64)}`)).toBe(
			false,
		);
		expect(verifyPagerDutySignature(secret, body, digest)).toBe(false);
	});
});
