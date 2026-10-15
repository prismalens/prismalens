// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** A synthetic secret corpus (spec WU3/WU7) planted in every kind of capture output. */
import { generateKeyPairSync } from "node:crypto";

const PEM = generateKeyPairSync("rsa", { modulusLength: 1024 })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString();

export const SECRETS = {
	awsId: "AKIA2E0A8F3B244C9986",
	awsSecret: "Zx9q2Lm4Rt7Vb1Nc8Kd3Hf6Jg0Ps5Wy2Ea7Ub4Io",
	github: ["ghp", "wWPw5k4aXcaT4fNP0UcnZwJUVFk6LO0pINUx"].join("_"),
	slack: ["xoxb", "2048112233-4096556677889-Qw3rTy8uIoP4aSdF6gHjK2lZ"].join("-"),
	bearer: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl",
	dbPassword: "hunter2-db-value",
	pgPassword: "x-pg-value",
	apiKey: "k3y-in-query",
	pemLine: PEM.split("\n")[1] ?? "",
} as const;

/** Every corpus shape as log lines, the form the text pass sees. */
export const SECRET_LOG = [
	`2026-10-15T09:57:50Z AWS_ACCESS_KEY_ID=${SECRETS.awsId}`,
	`2026-10-15T09:57:51Z aws_secret_access_key = ${SECRETS.awsSecret}`,
	`2026-10-15T09:57:52Z cloning with ${SECRETS.github}`,
	`2026-10-15T09:57:53Z posting with ${SECRETS.slack}`,
	`2026-10-15T09:57:54Z Authorization: Bearer ${SECRETS.bearer}`,
	`2026-10-15T09:57:55Z DB_PASSWORD=${SECRETS.dbPassword}`,
	`2026-10-15T09:57:56Z config {"POSTGRES_PASSWORD": "${SECRETS.pgPassword}"}`,
	`2026-10-15T09:57:57Z GET /v1/orders?api_key=${SECRETS.apiKey}&page=2`,
	PEM,
].join("\n");
