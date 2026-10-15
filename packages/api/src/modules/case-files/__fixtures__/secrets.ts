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
	// #842 round 3: unnamed canaries, named so no earlier pattern matches them.
	encryptionKey: "EncKeyV4lue9",
	signingKey: "SignKeyV4lue9",
	dbCredentials: "DbCredV4lue9",
	basicAuth: Buffer.from("svc:BasicPassw0rd").toString("base64"),
	cookie: "C00kieSess1on",
	setCookie: "SetC00kieSid",
	jwt: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1bm5hbWVkIn0.c2lnbmF0dXJlLWJhcmU",
} as const;

const PEM_BODY = PEM.split("\n").filter(
	(l) => l !== "" && !l.startsWith("-----"),
);

/** Every value that must not leak, with its base64 and URL-encoded copies (#842 OBJ-016). */
export const CANARIES: ReadonlyArray<readonly [string, string]> = [
	...Object.entries(SECRETS),
	...PEM_BODY.map((line, i) => [`pem body ${i}`, line] as const),
].flatMap(([name, value]) => {
	const forms: Array<readonly [string, string]> = [[name, value]];
	const b64 = Buffer.from(value).toString("base64");
	if (b64 !== value) forms.push([`${name} (base64)`, b64]);
	const url = encodeURIComponent(value);
	if (url !== value) forms.push([`${name} (url)`, url]);
	return forms;
});

/** `kubectl logs --timestamps` form: an RFC3339Nano time and a space before every line. */
export function timestamped(text: string): string {
	const from = Date.parse("2026-10-15T09:57:50Z");
	return text
		.split("\n")
		.map(
			(line, i) =>
				`${new Date(from + i * 1000).toISOString().replace("Z", "123456Z")} ${line}`,
		)
		.join("\n");
}

/** A Warning event whose message carries only unnamed shapes. */
export const UNNAMED_EVENT_MESSAGE = `rotating ENCRYPTION_KEY=${SECRETS.encryptionKey} SIGNING_KEY=${SECRETS.signingKey}, got Cookie: session=${SECRETS.cookie} and issued ${SECRETS.jwt}`;

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

/** Every corpus shape as log lines, without kubectl's timestamps; see `timestamped`. */
export const SECRET_LOG = [
	`AWS_ACCESS_KEY_ID=${SECRETS.awsId}`,
	`aws_secret_access_key = ${SECRETS.awsSecret}`,
	`cloning with ${SECRETS.github}`,
	`posting with ${SECRETS.slack}`,
	`Authorization: Bearer ${SECRETS.bearer}`,
	`DB_PASSWORD=${SECRETS.dbPassword}`,
	`config {"POSTGRES_PASSWORD": "${SECRETS.pgPassword}"}`,
	`GET /v1/orders?api_key=${SECRETS.apiKey}&page=2`,
	`exec app --password ${SECRETS.splitFlag} --api-token "${SECRETS.quotedA} ${SECRETS.quotedB}"`,
	`connecting to amqp://app:${SECRETS.urlPassword}@mq.shop:5672/`,
	`auth failed for app, password: ${SECRETS.colonPassword}`,
	`running mysql -u root -p ${SECRETS.mysqlSpaced} -e 'select 1'`,
	`running mysql -u root -p${SECRETS.mysqlAttached} shop`,
	`pwd: ${SECRETS.pwdColon} api key: ${SECRETS.apiKeySpaced}`,
	`token: ${SECRETS.tokenA} ${SECRETS.tokenB}`,
	"dumping config:",
	"db:",
	"  password: |",
	`    ${SECRETS.yamlBlock}`,
	"  secret:",
	`    ${SECRETS.nextLine}`,
	`ENCRYPTION_KEY=${SECRETS.encryptionKey}`,
	`SIGNING_KEY=${SECRETS.signingKey} DB_CREDENTIALS=${SECRETS.dbCredentials}`,
	`GET /orders Authorization: Basic ${SECRETS.basicAuth}`,
	`Cookie: session=${SECRETS.cookie}; theme=dark`,
	`Set-Cookie: sid=${SECRETS.setCookie}; Path=/; HttpOnly`,
	`issued ${SECRETS.jwt} to checkout`,
	PEM.trimEnd(),
	"// secretlint-disable",
	`DB_PASSWORD=${SECRETS.afterDisable}`,
	`retrying with password: "${SECRETS.endTruncated}`,
].join("\n");
