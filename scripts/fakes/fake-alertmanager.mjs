#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Serves /api/v2/alerts and /api/v2/status from a list the test edits, and posts
// real v4 webhooks. How to use it: packages/frontend/e2e/README.md.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const FNV_OFFSET_64 = 14695981039346656037n;
const FNV_PRIME_64 = 1099511628211n;
const MASK_64 = 0xffffffffffffffffn;
const encoder = new TextEncoder();

/**
 * prometheus/common `LabelSet.Fingerprint()`; `test/scenarios/fakes.spec.ts` pins it to the app's copy.
 * @param {Record<string, string>} labels
 */
export function fingerprintOf(labels) {
	const names = Object.keys(labels).sort((a, b) =>
		Buffer.from(a).compare(Buffer.from(b)),
	);
	let hash = FNV_OFFSET_64;
	const feed = (/** @type {Iterable<number>} */ bytes) => {
		for (const byte of bytes) {
			hash ^= BigInt(byte);
			hash = (hash * FNV_PRIME_64) & MASK_64;
		}
	};
	for (const name of names) {
		feed(encoder.encode(name));
		feed([0xff]);
		feed(encoder.encode(labels[name]));
		feed([0xff]);
	}
	return hash.toString(16).padStart(16, "0");
}

/**
 * @param {{ port?: number, host?: string, startedAt?: Date, receiver?: string }} [options]
 */
export async function startFakeAlertmanager(options = {}) {
	const host = options.host ?? "127.0.0.1";
	const receiver = options.receiver ?? "prismalens";
	// Up for an hour by default: PrismaLens ignores absence from an Alertmanager younger than 10 min.
	let startedAt = options.startedAt ?? new Date(Date.now() - 60 * 60 * 1000);
	/** @type {Map<string, import("./fake-alertmanager.d.mts").ListedAlert>} */
	const listed = new Map();
	/** @type {import("./fake-alertmanager.d.mts").ListedAlert[]} */
	let resolvedSinceLastPost = [];

	const server = createServer((req, res) => {
		const path = (req.url ?? "/").split("?")[0];
		const reply = (
			/** @type {number} */ status,
			/** @type {unknown} */ body,
		) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.method === "GET" && path === "/api/v2/alerts") {
			return reply(200, [...listed.values()].map(gettable));
		}
		if (req.method === "GET" && path === "/api/v2/status") {
			return reply(200, {
				cluster: { status: "ready", peers: [] },
				versionInfo: { version: "0.28.1-fake" },
				config: { original: "" },
				uptime: startedAt.toISOString(),
			});
		}
		if (req.method === "GET" && (path === "/-/healthy" || path === "/-/ready"))
			return reply(200, "OK");
		reply(404, { error: `fake-alertmanager: no route ${req.method} ${path}` });
	});

	/** @param {import("./fake-alertmanager.d.mts").ListedAlert} a */
	function gettable(a) {
		return {
			labels: a.labels,
			annotations: a.annotations,
			startsAt: a.startsAt,
			endsAt: a.endsAt,
			updatedAt: a.startsAt,
			generatorURL: a.generatorURL,
			fingerprint: a.fingerprint,
			receivers: [{ name: receiver }],
			status: { state: a.state, silencedBy: [], inhibitedBy: [] },
		};
	}

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, host, () => resolve(undefined));
	});
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("fake-alertmanager: no TCP address");
	}
	const url = `http://${host}:${address.port}`;

	return {
		url,
		alerts: () => [...listed.values()],
		/** A refire of a listed label set keeps its startsAt, as Alertmanager does. */
		fire(/** @type {import("./fake-alertmanager.d.mts").FireInput} */ input) {
			const fingerprint = fingerprintOf(input.labels);
			const existing = listed.get(fingerprint);
			const alert = {
				labels: { ...input.labels },
				annotations: { ...(input.annotations ?? {}) },
				startsAt:
					existing?.startsAt ?? input.startsAt ?? new Date().toISOString(),
				endsAt: "0001-01-01T00:00:00.000Z",
				generatorURL:
					input.generatorURL ?? "http://prometheus.fake:9090/graph?g0.expr=up",
				fingerprint,
				state: input.state ?? "active",
			};
			listed.set(fingerprint, alert);
			return alert;
		},
		clear(/** @type {string} */ fingerprint) {
			const alert = listed.get(fingerprint);
			if (!alert) return false;
			listed.delete(fingerprint);
			resolvedSinceLastPost.push({
				...alert,
				endsAt: new Date().toISOString(),
			});
			return true;
		},
		/** Alertmanager keeps alerts in memory: a restart lists nothing and its uptime starts now. */
		restart(/** @type {Date} */ at = new Date()) {
			listed.clear();
			resolvedSinceLastPost = [];
			startedAt = at;
		},
		setStartedAt(/** @type {Date} */ at) {
			startedAt = at;
		},
		/** Like one group notification: listed alerts firing, alerts cleared since the last post resolved. */
		async post(
			/** @type {string} */ webhookUrl,
			/** @type {string} */ token,
			/** @type {{ only?: string[] }} */ opts = {},
		) {
			const pick = (/** @type {{ fingerprint: string }} */ a) =>
				!opts.only || opts.only.includes(a.fingerprint);
			const firing = [...listed.values()]
				.filter((a) => a.state === "active")
				.filter(pick)
				.map((a) => ({ ...wire(a), status: "firing" }));
			const resolved = resolvedSinceLastPost
				.filter(pick)
				.map((a) => ({ ...wire(a), status: "resolved" }));
			resolvedSinceLastPost = resolvedSinceLastPost.filter((a) => !pick(a));
			const alerts = [...firing, ...resolved];
			const common = commonLabels(alerts.map((a) => a.labels));
			const body = {
				version: "4",
				groupKey: `{}:{alertname="${common.alertname ?? ""}"}`,
				truncatedAlerts: 0,
				status: firing.length > 0 ? "firing" : "resolved",
				receiver,
				groupLabels: common.alertname ? { alertname: common.alertname } : {},
				commonLabels: common,
				commonAnnotations: {},
				externalURL: url,
				alerts,
			};
			return fetch(webhookUrl, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"user-agent": "Alertmanager/0.28.1",
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(body),
			});
		},
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve(undefined));
			}),
	};
}

/** @param {import("./fake-alertmanager.d.mts").ListedAlert} a */
function wire(a) {
	return {
		labels: a.labels,
		annotations: a.annotations,
		startsAt: a.startsAt,
		endsAt: a.endsAt,
		generatorURL: a.generatorURL,
		fingerprint: a.fingerprint,
	};
}

/** @param {Record<string, string>[]} sets */
function commonLabels(sets) {
	if (sets.length === 0) return {};
	/** @type {Record<string, string>} */
	const common = { ...sets[0] };
	for (const set of sets.slice(1)) {
		for (const key of Object.keys(common)) {
			if (set[key] !== common[key]) delete common[key];
		}
	}
	return common;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const portArg = process.argv.indexOf("--port");
	const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 9093;
	const am = await startFakeAlertmanager({ port });
	console.log(`fake-alertmanager listening on ${am.url}`);
}
