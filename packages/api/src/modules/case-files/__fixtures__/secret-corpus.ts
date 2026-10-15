// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { generateKeyPairSync } from "node:crypto";
import type { ArtifactPurpose } from "@prismalens/contracts";

export const PEM_PRIVATE_KEY = generateKeyPairSync("rsa", {
	modulusLength: 1024,
})
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString();

export const SECRETS = {
	awsId: "AKIA2E0A8F3B244C9986",
	awsSecret: "Zx9q2Lm4Rt7Vb1Nc8Kd3Hf6Jg0Ps5Wy2Ea7Ub4Io",
	github: ["ghp", "wWPw5k4aXcaT4fNP0UcnZwJUVFk6LO0pINUx"].join("_"),
	slack: ["xoxb", "123456789012-1234567890123-456789abcdef456789abcdef"].join("-"),
	bearer: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl",
	dbPassword: "hunter2",
	pgPassword: "x-pg-value",
	apiKey: "k3y-in-query",
} as const;

export const RAW_SECRET_VALUES: readonly string[] = [
	SECRETS.awsId,
	SECRETS.awsSecret,
	SECRETS.github,
	SECRETS.slack,
	SECRETS.bearer,
	SECRETS.dbPassword,
	SECRETS.pgPassword,
	SECRETS.apiKey,
	PEM_PRIVATE_KEY.split("\n")[1]!,
];

export const SYNTHETIC_LOG = [
	`2026-10-15T10:00:00Z AWS_ACCESS_KEY_ID=${SECRETS.awsId}`,
	`2026-10-15T10:00:01Z aws_secret_access_key = ${SECRETS.awsSecret}`,
	`2026-10-15T10:00:02Z cloning with ${SECRETS.github}`,
	`2026-10-15T10:00:02Z slack token ${SECRETS.slack}`,
	`2026-10-15T10:00:03Z Authorization: Bearer ${SECRETS.bearer}`,
	`2026-10-15T10:00:04Z DB_PASSWORD=${SECRETS.dbPassword}`,
	`2026-10-15T10:00:05Z config {"POSTGRES_PASSWORD": "${SECRETS.pgPassword}"}`,
	`2026-10-15T10:00:06Z GET /v1/orders?api_key=${SECRETS.apiKey}&page=2`,
	PEM_PRIVATE_KEY,
	"-----BEGIN CERTIFICATE-----",
	"MIIBszCCAVmgAwIBAgIUQ",
	"-----END CERTIFICATE-----",
].join("\n");

export function corpusFor(purpose: ArtifactPurpose): Buffer {
	if (purpose === "logs-previous") {
		return Buffer.from(SYNTHETIC_LOG);
	}
	if (purpose === "events") {
		return Buffer.from(
			JSON.stringify({
				kind: "EventList",
				items: [
					{
						metadata: { name: "evt-1" },
						message: "alert on host",
						POSTGRES_PASSWORD: SECRETS.pgPassword,
						DB_PASSWORD: SECRETS.dbPassword,
						note: `AWS_ACCESS_KEY_ID=${SECRETS.awsId} aws_secret_access_key = ${SECRETS.awsSecret} ${SECRETS.github} ${SECRETS.slack} Authorization: Bearer ${SECRETS.bearer} https://api?api_key=${SECRETS.apiKey}`,
						pem: PEM_PRIVATE_KEY,
					},
				],
			}),
		);
	}
	return Buffer.from(
		JSON.stringify({
			kind: "List",
			items: [
				{
					metadata: {
						name: "checkout",
						managedFields: [{ manager: "kubectl" }],
						annotations: {
							"kubectl.kubernetes.io/last-applied-configuration":
								'{"env":"SECRET"}',
							"deployment.kubernetes.io/revision": "7",
							note: `AWS_ACCESS_KEY_ID=${SECRETS.awsId} aws_secret_access_key = ${SECRETS.awsSecret} ${SECRETS.github} ${SECRETS.slack} Authorization: Bearer ${SECRETS.bearer} https://api?api_key=${SECRETS.apiKey}`,
							pem: PEM_PRIVATE_KEY,
						},
					},
					spec: {
						template: {
							spec: {
								containers: [
									{
										name: "app",
										env: [
											{ name: "POSTGRES_PASSWORD", value: SECRETS.pgPassword },
											{ name: "DB_PASSWORD", value: SECRETS.dbPassword },
										],
									},
								],
							},
						},
					},
				},
			],
		}),
	);
}
