// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REDACT_CONFIG, type RedactConfig, redact, redactText } from "./redact.js";

const PEM = generateKeyPairSync("rsa", { modulusLength: 1024 })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString();

const SECRETS = {
	awsId: "AKIA2E0A8F3B244C9986",
	awsSecret: "Zx9q2Lm4Rt7Vb1Nc8Kd3Hf6Jg0Ps5Wy2Ea7Ub4Io",
	github: ["ghp", "wWPw5k4aXcaT4fNP0UcnZwJUVFk6LO0pINUx"].join("_"),
	bearer: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl",
	dbPassword: "hunter2",
	pgPassword: "x-pg-value",
	apiKey: "k3y-in-query",
};

const LOG = [
	`2026-10-15T10:00:00Z AWS_ACCESS_KEY_ID=${SECRETS.awsId}`,
	`2026-10-15T10:00:01Z aws_secret_access_key = ${SECRETS.awsSecret}`,
	`2026-10-15T10:00:02Z cloning with ${SECRETS.github}`,
	`2026-10-15T10:00:03Z Authorization: Bearer ${SECRETS.bearer}`,
	`2026-10-15T10:00:04Z DB_PASSWORD=${SECRETS.dbPassword}`,
	`2026-10-15T10:00:05Z config {"POSTGRES_PASSWORD": "${SECRETS.pgPassword}"}`,
	`2026-10-15T10:00:06Z GET /v1/orders?api_key=${SECRETS.apiKey}&page=2`,
	PEM,
	"-----BEGIN CERTIFICATE-----",
	"MIIBszCCAVmgAwIBAgIUQ",
	"-----END CERTIFICATE-----",
].join("\n");

const DEPLOYMENTS = {
	kind: "List",
	items: [
		{
			metadata: {
				name: "checkout",
				managedFields: [{ manager: "kubectl" }],
				annotations: {
					"kubectl.kubernetes.io/last-applied-configuration": '{"env":"SECRET"}',
					"deployment.kubernetes.io/revision": "7",
				},
			},
			spec: {
				template: {
					spec: {
						containers: [
							{
								name: "app",
								env: [
									{ name: "DATABASE_URL", value: "postgres://u:p@db/x" },
									{ name: "FROM_SECRET", valueFrom: { secretKeyRef: { name: "s", key: "k" } } },
								],
							},
						],
					},
				},
			},
		},
	],
};

describe("redact", () => {
	it("removes every secret in a log and keeps the certificate", async () => {
		const out = await redact("logs-previous", Buffer.from(LOG));
		if ("error" in out) throw new Error(out.error);
		const text = out.redacted.toString("utf8");
		for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
		expect(text).not.toContain(PEM.split("\n")[1]);
		expect(text).toContain("BEGIN CERTIFICATE");
		expect(text).toContain("DB_PASSWORD=[REDACTED:pattern]");
		expect(out.counts.pattern).toBeGreaterThan(0);
	});

	it("blanks env values, keeps names and valueFrom, drops managedFields and last-applied", async () => {
		const out = await redact("deployments", Buffer.from(JSON.stringify(DEPLOYMENTS)));
		if ("error" in out) throw new Error(out.error);
		const doc = JSON.parse(out.redacted.toString("utf8"));
		const item = doc.items[0];
		expect(item.metadata.managedFields).toBeUndefined();
		expect(item.metadata.annotations).toEqual({ "deployment.kubernetes.io/revision": "7" });
		expect(item.spec.template.spec.containers[0].env).toEqual([
			{ name: "DATABASE_URL", value: "[REDACTED:env]" },
			{ name: "FROM_SECRET", valueFrom: { secretKeyRef: { name: "s", key: "k" } } },
		]);
		expect(out.counts).toMatchObject({ env: 1, "last-applied-configuration": 1 });
	});

	it("fails closed when a rule throws or the workload JSON does not parse", async () => {
		const throwing: RedactConfig = {
			rules: [
				...REDACT_CONFIG.rules,
				{
					id: "boom",
					rule: {
						messages: {},
						meta: { id: "boom", recommended: false, type: "scanner", supportedContentTypes: ["text"] },
						create: () => ({
							file() {
								throw new Error("rule exploded");
							},
						}),
					},
				},
			],
		};
		expect(await redact("events", Buffer.from("{}"), throwing)).toEqual({
			error: expect.stringContaining("rule exploded"),
		});
		expect(await redact("pods", Buffer.from('{"items": ['))).toEqual({
			error: expect.stringContaining("structural pass"),
		});
		expect(await redactText("x", throwing)).toEqual({ error: expect.stringContaining("rule exploded") });
	});

	it("redacts a stderr tail as text", async () => {
		const out = await redactText(`error: token=${SECRETS.apiKey}`);
		expect(out).toEqual({ text: "error: token=[REDACTED:pattern]", counts: { pattern: 1 } });
	});
});
