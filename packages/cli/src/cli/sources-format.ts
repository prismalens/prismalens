// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CREDENTIAL_KIND_FIELDS,
	type ProbeReport,
	SOURCE_CATEGORIES,
	SOURCE_CATEGORY_INFO,
	SOURCE_CREDENTIAL_KINDS,
	SOURCE_TYPES,
	type SourceCredentialKind,
	type SourceDraft,
	type SourcesOverview,
	type SourceTypeDescriptor,
	sourceType,
} from "@prismalens/contracts/schemas";

const pad = (s: string, n: number) => s.padEnd(n);

/** `metrics: prometheus, alertmanager · logs: loki · scm: github`, for --help. */
export function vendorList(): string {
	return SOURCE_CATEGORIES.map(
		(c) =>
			[
				c,
				SOURCE_TYPES.filter((t) => t.category === c).map((t) => t.slug),
			] as const,
	)
		.filter(([, slugs]) => slugs.length)
		.map(([c, slugs]) => `${c}: ${slugs.join(", ")}`)
		.join(" · ");
}

/** The capability table the web flow shows on test and discover. */
export function probeTable(report: ProbeReport): string {
	const rows = report.probes.map((p) => [
		p.capability,
		p.need,
		p.ok ? "PASS" : "FAIL",
		p.detail,
	]);
	const w = [18, 9, 5];
	const lines = [
		`${pad("capability", w[0])} ${pad("needed", w[1])} ${pad("result", w[2])}`,
		...rows.map(
			([c, n, r, d]) =>
				`${pad(c ?? "", w[0])} ${pad(n ?? "", w[1])} ${pad(r ?? "", w[2])} ${d}`,
		),
	];
	if (report.discovered.serviceLabel)
		lines.push(`service label: ${report.discovered.serviceLabel}`);
	lines.push(`sends the credential only to: ${report.host}`);
	return lines.join("\n");
}

export function agentCanCall(type: SourceTypeDescriptor): string {
	return type.tools.length
		? `agent can call (read-only): ${type.tools.join(" ")}`
		: (type.uses ?? "");
}

/** The SOURCES table: one line per category, connected or not. */
export function overviewTable(o: SourcesOverview): string {
	const lines = o.categories.map((c) => {
		const names = c.sources.map((s) => s.label).join(", ") || "-";
		const state =
			c.status === "connected"
				? "connected"
				: c.status === "unreachable"
					? `unreachable  ${c.sources.find((s) => s.reason)?.reason ?? ""}`.trimEnd()
					: `not connected  ${SOURCE_CATEGORY_INFO[c.category].blind}`;
		return `${pad(c.category, 10)} ${pad(names, 31)} ${state}`;
	});
	for (const d of o.detected) {
		const t = sourceType(d.type);
		if (!t) continue;
		lines.push(
			`found ${t.vendor} via ${d.env}: pl connect ${t.category} ${t.slug}${d.url && !t.detect.tokenEnv ? ` --url ${d.url}` : " --use-detected"}`,
		);
	}
	return lines.join("\n");
}

export interface ConnectArgs {
	url?: string;
	authKind?: string;
	tokenEnv?: string;
	username?: string;
	passwordEnv?: string;
	headerName?: string;
	headerValueEnv?: string;
	cert?: string;
	key?: string;
	ca?: string;
	serviceLabel?: string;
	label?: string;
	useDetected?: boolean;
}

/** Flags to the draft the web form would send; secrets come from env vars or files, never argv. */
export function draftFromArgs(
	type: SourceTypeDescriptor,
	args: ConnectArgs,
	env: Readonly<Record<string, string | undefined>>,
	readFile: (path: string) => string,
	detectedUrl?: string,
): SourceDraft {
	const url = args.url ?? detectedUrl ?? type.url.default;
	if (!url) throw new Error(`Pass --url, e.g. --url ${type.url.placeholder}`);
	const base = {
		type: type.id,
		url,
		...(args.serviceLabel ? { serviceLabel: args.serviceLabel } : {}),
		...(args.label ? { label: args.label } : {}),
	};
	if (args.useDetected) return { ...base, useDetected: true };
	const kind = (args.authKind ??
		(args.tokenEnv
			? "bearer"
			: args.passwordEnv
				? "basic"
				: args.headerName
					? "header"
					: args.cert
						? "mtls"
						: type.credentialKinds[0])) as SourceCredentialKind;
	if (!(SOURCE_CREDENTIAL_KINDS as readonly string[]).includes(kind))
		throw new Error(`Unknown --auth-kind ${kind}`);
	if (!type.credentialKinds.includes(kind))
		throw new Error(
			`${type.vendor} takes ${type.credentialKinds.join(", ")}, not ${kind}`,
		);
	const fromEnv = (flag: string, name?: string) => {
		if (!name) throw new Error(`${kind} needs --${flag}`);
		const v = env[name];
		if (!v?.trim()) throw new Error(`${name} is empty or not set`);
		return v.trim();
	};
	const values: Record<string, string> = {
		bearer: () => ({ token: fromEnv("token-env", args.tokenEnv) }),
		basic: () => ({
			username: args.username ?? "",
			password: fromEnv("password-env", args.passwordEnv),
		}),
		header: () => ({
			name: args.headerName ?? "",
			value: fromEnv("header-value-env", args.headerValueEnv),
		}),
		mtls: () => ({
			cert: args.cert ? readFile(args.cert) : "",
			key: args.key ? readFile(args.key) : "",
			...(args.ca ? { ca: readFile(args.ca) } : {}),
		}),
		none: () => ({}),
	}[kind]();
	for (const f of CREDENTIAL_KIND_FIELDS[kind])
		if (f.required && !values[f.name])
			throw new Error(`${kind} needs ${f.label}`);
	return { ...base, credential: { kind, ...values } };
}
