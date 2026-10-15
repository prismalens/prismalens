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
	slack: ["xoxb", "2048112233-4096556677889-Qw3rTy8uIoP4aSdF6gHjK2lZ"].join(
		"-",
	),
	bearer: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl",
	dbPassword: "hunter2-db-value",
	pgPassword: "x-pg-value",
	apiKey: "k3y-in-query",
	pemLine: PEM.split("\n")[1] ?? "",
	// #842: a value after a disable directive, and the argv shapes; each word is checked alone.
	afterDisable: "s3cret-after-disable",
	splitFlag: "SYNTHETIC_SECRET_7zQ9",
	quotedA: "Qsp4ceAlpha",
	quotedB: "Qsp4ceBravo",
	urlPassword: "Ur1Cred3ntial",
	// #842 round 2: colon and YAML forms, mysql -p, multiline and truncated variants.
	colonPassword: "C0lonPassw0rd",
	multiline: "Multil1neSecret",
	mysqlSpaced: "MysqlSp4ced",
	mysqlAttached: "MysqlAtt4ched",
	pwdColon: "PwdC0lonValue",
	apiKeySpaced: "ApiKeySp4ced",
	tokenA: "Tok3nAlpha",
	tokenB: "Tok3nBravo",
	yamlBlock: "Yam1BlockValue",
	nextLine: "NextL1neValue",
	endTruncated: "EndTrunc4ted",
	headTruncated: "HeadTrunc4ted",
} as const;

/** A Warning event whose message carries the colon form, one line in and one escaped newline down. */
export const SECRET_EVENT_MESSAGE = `auth failed for app, password: ${SECRETS.colonPassword}\nsecret: ${SECRETS.multiline}`;

const STDERR_TAIL_BYTES = 2048;
const cutLine = `ssword: ${SECRETS.headTruncated}\n`;
/** Stderr whose kept 2 KiB tail starts inside the key `password`. */
export const SECRET_STDERR = `${"W".repeat(3000)}\nwarning: db pa${cutLine}${"z".repeat(STDERR_TAIL_BYTES - cutLine.length)}`;

/** Container argv carrying secrets as split flags, quoted values and URL credentials. */
export const SECRET_ARGV = {
	command: [
		"sh",
		"-c",
		`migrate --url amqp://app:${SECRETS.urlPassword}@mq.shop:5672/ --password '${SECRETS.quotedA} ${SECRETS.quotedB}'`,
	],
	args: [
		"--password",
		SECRETS.splitFlag,
		`redis://:${SECRETS.urlPassword}@cache:6379/0`,
	],
	readinessProbe: {
		exec: { command: ["check", "--token", SECRETS.splitFlag] },
	},
};

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
	`2026-10-15T09:57:58Z exec app --password ${SECRETS.splitFlag} --api-token "${SECRETS.quotedA} ${SECRETS.quotedB}"`,
	`2026-10-15T09:57:58Z connecting to amqp://app:${SECRETS.urlPassword}@mq.shop:5672/`,
	`2026-10-15T09:57:58Z auth failed for app, password: ${SECRETS.colonPassword}`,
	`2026-10-15T09:57:58Z running mysql -u root -p ${SECRETS.mysqlSpaced} -e 'select 1'`,
	`2026-10-15T09:57:58Z running mysql -u root -p${SECRETS.mysqlAttached} shop`,
	`2026-10-15T09:57:58Z pwd: ${SECRETS.pwdColon} api key: ${SECRETS.apiKeySpaced}`,
	`2026-10-15T09:57:58Z token: ${SECRETS.tokenA} ${SECRETS.tokenB}`,
	"2026-10-15T09:57:58Z dumping config:",
	"db:",
	"  password: |",
	`    ${SECRETS.yamlBlock}`,
	"  secret:",
	`    ${SECRETS.nextLine}`,
	PEM,
	"2026-10-15T09:57:59Z // secretlint-disable",
	`2026-10-15T09:57:59Z DB_PASSWORD=${SECRETS.afterDisable}`,
	`2026-10-15T09:57:59Z retrying with password: "${SECRETS.endTruncated}`,
].join("\n");
