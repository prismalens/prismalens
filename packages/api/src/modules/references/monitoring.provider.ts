// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	REFERENCE_SNAPSHOT_MAX_CHARS,
	type ReferenceKind,
	type ReferenceRef,
	type ReferenceSnapshot,
} from "@prismalens/contracts";
import type { OpenedSource } from "../integrations/open-source.js";
import { failureReason, getJson } from "../integrations/source-query.js";
import type {
	ReferenceCandidate,
	ReferenceContext,
	ReferenceProvider,
} from "./reference-provider.js";
import { SourceUnavailable } from "./reference-provider.js";

/** A menu answer must come back quickly, whatever one source does. */
const TIMEOUT_MS = 3_000;
const MAX_BYTES = 2_000_000;
const TAKE = 50;

/** The active connections of one template, and a way to open each with its stored credential. */
export interface MonitoringSources {
	connections(
		templateId: "alertmanager" | "prometheus",
	): Promise<{ id: string; label: string }[]>;
	open(src: { id: string; label: string; kind: string }): Promise<OpenedSource>;
	/** The URL a connection was saved with; a pasted link counts only on its origin and path. */
	baseUrl?(connectionId: string): Promise<string | null>;
}

/** What a pasted link names: one kind, and how to find its item among the source's. */
type Wanted = { kind: ReferenceKind; is: (item: Item) => boolean };

/** `{alertname="X", ...}` in an Alertmanager filter: X, else null. */
function alertnameOf(filter: string | null): string | null {
	return filter
		? (/alertname\s*=\s*"([^"]+)"/.exec(filter)?.[1] ?? null)
		: null;
}

/** Alertmanager's UI routes in the fragment: `#/silences/<id>`, `#/alerts?filter={alertname="X"}`. */
function alertmanagerWanted(url: URL): Wanted | null {
	const [path = "", query = ""] = url.hash.replace(/^#/, "").split("?");
	const silence = /^\/silences\/([\w-]+)$/.exec(path);
	if (silence)
		return { kind: "silence", is: (i) => i.ref.id.endsWith(`:${silence[1]}`) };
	const name =
		path === "/alerts"
			? alertnameOf(new URLSearchParams(query).get("filter"))
			: null;
	return name ? { kind: "alert", is: (i) => i.ref.label === name } : null;
}

/** Prometheus's `/alerts?search=X` or `/rules?search=X`: the alerting rule named X. */
function prometheusWanted(url: URL): Wanted | null {
	const page = url.pathname.split("/").filter(Boolean).pop();
	const name = url.searchParams.get("search")?.trim();
	return (page === "alerts" || page === "rules") && name
		? { kind: "alert_rule", is: (i) => i.ref.label === name }
		: null;
}

/** The link is on the connection's origin and under its path. */
function onConnection(base: string, url: URL): boolean {
	let b: URL;
	try {
		b = new URL(base);
	} catch {
		return false;
	}
	const root = b.pathname.endsWith("/") ? b.pathname : `${b.pathname}/`;
	return (
		b.origin === url.origin &&
		(url.pathname === b.pathname || `${url.pathname}/`.startsWith(root))
	);
}

type Item = { ref: ReferenceRef; detail: string; text: string };
type Lister = (src: OpenedSource, signal: AbortSignal) => Promise<Item[]>;

/** A ref id names its connection, so a snapshot reads the same source again. */
const refId = (connectionId: string, key: string) => `${connectionId}:${key}`;

function cut(text: string): string {
	return text.length > REFERENCE_SNAPSHOT_MAX_CHARS
		? `${text.slice(0, REFERENCE_SNAPSHOT_MAX_CHARS - 1)}…`
		: text;
}

const label = (s: string) => s.slice(0, 200) || "(unnamed)";
const labels = (l: unknown) =>
	l && typeof l === "object"
		? Object.entries(l as Record<string, unknown>)
				.map(([k, v]) => `${k}="${String(v)}"`)
				.join(", ")
		: "";

/** Alertmanager v2: firing alerts and silences. */
const ALERTMANAGER: Partial<Record<ReferenceKind, Lister>> = {
	alert: async (src, signal) => {
		const data = await getJson(
			src,
			"api/v2/alerts",
			{ active: "true" },
			signal,
		);
		return (Array.isArray(data) ? data : []).flatMap((a) => {
			const x = a as {
				fingerprint?: string;
				labels?: Record<string, string>;
				annotations?: Record<string, string>;
				startsAt?: string;
				status?: { state?: string };
			};
			if (!x.fingerprint) return [];
			const name = x.labels?.alertname ?? x.fingerprint;
			return [
				{
					ref: {
						kind: "alert",
						id: refId(src.id, x.fingerprint),
						label: label(name),
					},
					detail: `${x.status?.state ?? "active"} · ${x.labels?.severity ?? "no severity"}`,
					text: [
						`Alertmanager alert "${name}", ${x.status?.state ?? "active"}, since ${x.startsAt ?? "unknown"}.`,
						`Labels: ${labels(x.labels)}`,
						x.annotations?.summary ? `Summary: ${x.annotations.summary}` : "",
						x.annotations?.description
							? `Description: ${x.annotations.description}`
							: "",
					]
						.filter(Boolean)
						.join("\n"),
				},
			];
		});
	},
	silence: async (src, signal) => {
		const data = await getJson(src, "api/v2/silences", {}, signal);
		return (Array.isArray(data) ? data : []).flatMap((s) => {
			const x = s as {
				id?: string;
				comment?: string;
				createdBy?: string;
				endsAt?: string;
				status?: { state?: string };
				matchers?: {
					name: string;
					value: string;
					isRegex?: boolean;
					isEqual?: boolean;
				}[];
			};
			if (!x.id || x.status?.state === "expired") return [];
			const matchers = (x.matchers ?? [])
				.map(
					(m) =>
						`${m.name}${m.isEqual === false ? "!" : ""}${m.isRegex ? "=~" : "="}"${m.value}"`,
				)
				.join(", ");
			return [
				{
					ref: {
						kind: "silence",
						id: refId(src.id, x.id),
						label: label(x.comment || matchers),
					},
					detail: `${x.status?.state ?? "active"} until ${x.endsAt ?? "unknown"}`,
					text: `Alertmanager silence ${x.id} (${x.status?.state ?? "active"}) by ${x.createdBy ?? "unknown"} until ${x.endsAt ?? "unknown"}: {${matchers}}. ${x.comment ?? ""}`.trim(),
				},
			];
		});
	},
};

/** Prometheus: alerting rules, and the alerts they have firing. */
const PROMETHEUS: Partial<Record<ReferenceKind, Lister>> = {
	alert_rule: async (src, signal) => {
		const data = (await getJson(
			src,
			"api/v1/rules",
			{ type: "alert" },
			signal,
		)) as {
			data?: {
				groups?: { name?: string; rules?: Record<string, unknown>[] }[];
			};
		};
		return (data?.data?.groups ?? []).flatMap((g) =>
			(g.rules ?? []).flatMap((r) => {
				const name = typeof r.name === "string" ? r.name : "";
				if (!name) return [];
				return [
					{
						ref: {
							kind: "alert_rule",
							id: refId(src.id, `${g.name ?? ""}/${name}`),
							label: label(name),
						},
						detail: `${String(r.state ?? "inactive")} · ${g.name ?? ""}`,
						text: [
							`Prometheus alerting rule "${name}" in group ${g.name ?? "?"}, ${String(r.state ?? "inactive")}.`,
							`Expression: ${String(r.query ?? "")}`,
							r.duration ? `For: ${String(r.duration)}s` : "",
							`Labels: ${labels(r.labels)}`,
						]
							.filter(Boolean)
							.join("\n"),
					},
				];
			}),
		);
	},
	alert: async (src, signal) => {
		const data = (await getJson(src, "api/v1/alerts", {}, signal)) as {
			data?: {
				alerts?: {
					labels?: Record<string, string>;
					state?: string;
					activeAt?: string;
					value?: string;
				}[];
			};
		};
		return (data?.data?.alerts ?? []).flatMap((a, i) => {
			const name = a.labels?.alertname ?? `alert ${i + 1}`;
			const key = `${name}{${labels(a.labels)}}`;
			return [
				{
					ref: { kind: "alert", id: refId(src.id, key), label: label(name) },
					detail: `${a.state ?? "firing"} · Prometheus`,
					text: `Prometheus alert "${name}", ${a.state ?? "firing"} since ${a.activeAt ?? "unknown"}, value ${a.value ?? "?"}.\nLabels: ${labels(a.labels)}`,
				},
			];
		});
	},
};

/**
 * One monitoring source's live items under `@` (#1024 spec B), read through the source's
 * own client and stored credential. A connection with no usable credential, or one
 * that does not answer in time, is one unavailable line; the other sources still answer.
 */
export class MonitoringProvider implements ReferenceProvider {
	readonly kinds: readonly ReferenceKind[];
	private readonly listers: Partial<Record<ReferenceKind, Lister>>;

	constructor(
		readonly source: "Alertmanager" | "Prometheus",
		private readonly sources: MonitoringSources,
	) {
		this.listers = source === "Alertmanager" ? ALERTMANAGER : PROMETHEUS;
		this.kinds = Object.keys(this.listers) as ReferenceKind[];
	}

	private get templateId() {
		return this.source === "Alertmanager" ? "alertmanager" : "prometheus";
	}

	/** Every item of `kinds` from every connection; throws only when none answered. */
	private async items(kinds: readonly ReferenceKind[], signal?: AbortSignal) {
		const conns = await this.sources.connections(this.templateId);
		const out: { connectionLabel: string; item: Item }[] = [];
		const failed: string[] = [];
		await Promise.all(
			conns.map(async (c) => {
				const where =
					conns.length > 1 ? `${this.source} · ${c.label}` : this.source;
				const src = await this.sources.open({ ...c, kind: this.templateId });
				if (src.unusable) {
					failed.push(`${where}: ${src.unusable}`);
					return;
				}
				const timeout = AbortSignal.timeout(TIMEOUT_MS);
				const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
				for (const kind of kinds) {
					const list = this.listers[kind];
					if (!list) continue;
					try {
						for (const item of await list(src, stop))
							out.push({ connectionLabel: where, item });
					} catch (e) {
						failed.push(`${where}: ${failureReason(e)}`);
						return;
					}
				}
			}),
		);
		if (failed.length && !out.length)
			throw new SourceUnavailable(this.source, failed[0] as string);
		return out;
	}

	async search(
		q: string,
		ctx: ReferenceContext,
	): Promise<ReferenceCandidate[]> {
		const kinds = this.kinds.filter((k) => ctx.kinds.includes(k));
		if (!kinds.length) return [];
		const needle = q.trim().toLowerCase();
		const found = await this.items(kinds, ctx.signal);
		return found
			.filter(
				({ item }) =>
					!needle ||
					`${item.ref.label} ${item.detail}`.toLowerCase().includes(needle),
			)
			.slice(0, TAKE)
			.map(({ connectionLabel, item }) => ({
				ref: item.ref,
				detail: item.detail.slice(0, 300),
				group: connectionLabel.slice(0, 120),
			}));
	}

	/**
	 * A pasted link on a saved connection's origin, read through that connection: an
	 * Alertmanager silence or alert by name, or a Prometheus alerting rule by name.
	 */
	async resolveUrl(
		url: URL,
		signal: AbortSignal,
	): Promise<ReferenceCandidate | null> {
		const baseUrl = this.sources.baseUrl?.bind(this.sources);
		if (!baseUrl) return null;
		const conns = await this.sources.connections(this.templateId);
		for (const c of conns) {
			const base = await baseUrl(c.id);
			if (!base || !onConnection(base, url)) continue;
			const wanted =
				this.source === "Alertmanager"
					? alertmanagerWanted(url)
					: prometheusWanted(url);
			if (!wanted)
				throw new SourceUnavailable(
					this.source,
					"this link names no single alert, silence or rule",
				);
			const found = await this.items([wanted.kind], signal);
			const hit = found.find(
				({ item }) => item.ref.id.startsWith(`${c.id}:`) && wanted.is(item),
			);
			if (!hit)
				throw new SourceUnavailable(
					this.source,
					"nothing on it matches this link",
				);
			return {
				ref: hit.item.ref,
				detail: hit.item.detail.slice(0, 300),
				group: hit.connectionLabel.slice(0, 120),
			};
		}
		return null;
	}

	async snapshot(ref: ReferenceRef): Promise<ReferenceSnapshot | null> {
		if (!this.kinds.includes(ref.kind)) return null;
		const conn = ref.id.slice(0, ref.id.indexOf(":"));
		if (!conn) return null;
		const conns = await this.sources.connections(this.templateId);
		if (!conns.some((c) => c.id === conn)) return null;
		const found = await this.items([ref.kind]).catch(
			(): Awaited<ReturnType<MonitoringProvider["items"]>> => [],
		);
		const hit = found.find(({ item }) => item.ref.id === ref.id);
		return hit ? { ref, text: cut(hit.item.text), outOfScope: true } : null;
	}
}

/** The live sources' providers, reading connections and credentials through the integrations module. */
export function monitoringProviders(
	sources: MonitoringSources,
): MonitoringProvider[] {
	return [
		new MonitoringProvider("Alertmanager", sources),
		new MonitoringProvider("Prometheus", sources),
	];
}

/** How a menu reads a source: quickly, bounded, and never following a redirect with the credential. */
export const MONITORING_REQUEST = {
	timeoutMs: TIMEOUT_MS,
	maxBytes: MAX_BYTES,
	maxRedirects: 0,
};
