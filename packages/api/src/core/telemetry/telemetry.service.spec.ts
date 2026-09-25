// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_IDS } from "@prismalens/config/harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service.js";
import {
	ALLOWED_PROPERTY_VALUES,
	classifyError,
	DURATION_BUCKETS,
	durationBucket,
	ERROR_CLASSES,
	integrationKindFor,
	runMode,
	build,
	sanitize,
	type TelemetryEvent,
	type TelemetryEventProps,
	TelemetryService,
	telemetryForcedOff,
	triggerFor,
} from "./telemetry.service.js";

function fakePrisma() {
	const rows = new Map<string, { value: string }>();
	return {
		rows,
		setting: {
			findUnique: vi.fn(
				async ({ where }: { where: { key: string } }) =>
					rows.get(where.key) ?? null,
			),
			upsert: vi.fn(
				async ({
					where,
					create,
				}: {
					where: { key: string };
					create: { value: string };
				}) => {
					rows.set(where.key, { value: create.value });
				},
			),
		},
	};
}

function setup(clock?: () => Date) {
	const prisma = fakePrisma();
	const fetchImpl = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(null, { status: 200 }),
	);
	const service = new TelemetryService(
		prisma as unknown as PrismaService,
		fetchImpl as unknown as typeof fetch,
		clock,
	);
	const sent = () =>
		fetchImpl.mock.calls.map(
			([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>,
		);
	const propsOf = (index: number) =>
		sent()[index].properties as Record<string, unknown>;
	return { prisma, service, fetchImpl, sent, propsOf };
}

/**
 * Pin every force-off input, so what these tests assert depends on the code
 * rather than on the shell that started them.
 *
 * All three are read from the live `process.env` on each capture, by design.
 * `CI` is the one that bites hardest — it is set in GitHub Actions and not on a
 * laptop, so a send-path test would pass locally and fail only in CI — but a
 * developer with `PRISMALENS_TELEMETRY=off` or `DO_NOT_TRACK=1` exported would
 * see the same class of failure, in the opposite direction. The individual
 * force-off cases stub their own variable afterwards, which overrides this.
 */
beforeEach(() => {
	vi.stubEnv("CI", "");
	vi.stubEnv("PRISMALENS_TELEMETRY", "");
	vi.stubEnv("DO_NOT_TRACK", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("TelemetryService (#602)", () => {
	it("is off and undecided until the owner answers, and sends nothing", async () => {
		const { service, fetchImpl } = setup();
		expect(await service.getSettings()).toEqual({
			enabled: false,
			decided: false,
			forcedOff: false,
			recentlySent: [],
		});
		await service.capture("service_added", { source: "git" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("a no is remembered as decided and still sends nothing", async () => {
		const { service, fetchImpl } = setup();
		expect(await service.setEnabled(false)).toMatchObject({
			enabled: false,
			decided: true,
		});
		await service.capture("service_added", { source: "git" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("opting in reports setup once, then events with only the allowed fields", async () => {
		const { service, sent, propsOf } = setup();
		await service.setEnabled(true);
		await service.setEnabled(false);
		await service.setEnabled(true);
		await service.capture("investigation_started", {
			harness: "opencode",
			trigger: "webhook",
		});

		const events = sent();
		expect(events.map((e) => e.event)).toEqual([
			"setup_completed",
			"investigation_started",
		]);
		expect(Object.keys(events[1]).sort()).toEqual([
			"api_key",
			"distinct_id",
			"event",
			"properties",
			"timestamp",
		]);
		expect(Object.keys(propsOf(1)).sort()).toEqual([
			"$geoip_disable",
			"$lib",
			"$lib_version",
			"$process_person_profile",
			"app_version",
			"arch",
			"build",
			"harness",
			"node_major",
			"os",
			"run_mode",
			"trigger",
		]);
		expect(events[1].distinct_id).toBe(events[0].distinct_id);
	});

	it("disables PostHog's server-side geolocation on every event", async () => {
		const { service, sent, propsOf } = setup();
		await service.setEnabled(true);
		await service.capture("report_viewed", {});
		await service.capture("incident_closed", {});
		expect(sent()).toHaveLength(3);
		for (let i = 0; i < 3; i++) {
			// Without this PostHog attaches $ip and city-level $geoip_* at ingest.
			expect(propsOf(i).$geoip_disable).toBe(true);
			expect(propsOf(i).$process_person_profile).toBe(false);
		}
	});

	it("identifies itself in place of an SDK, at the app version", async () => {
		const { service, propsOf } = setup();
		await service.setEnabled(true);
		expect(propsOf(0).$lib).toBe("prismalens-api");
		expect(propsOf(0).$lib_version).toBe(propsOf(0).app_version);
		expect(typeof propsOf(0).app_version).toBe("string");
	});

	it("carries the common fields on every event", async () => {
		const { service, propsOf } = setup();
		await service.setEnabled(true);
		expect(propsOf(0).run_mode).toBe("npm");
		expect(propsOf(0).build).toBe("dev");
		expect(propsOf(0).os).toBe(process.platform);
		expect(propsOf(0).arch).toBe(process.arch);
		expect(propsOf(0).node_major).toBe(
			Number.parseInt(process.versions.node, 10),
		);
	});

	it("reports one terminal state per investigation, as a bucket and a class", async () => {
		const { service, sent, propsOf } = setup();
		await service.setEnabled(true);
		const startedAt = new Date(Date.now() - 3 * 60_000);
		await service.captureFinished("inv-1", "failed", {
			startedAt,
			error: "claude not found on PATH",
		});
		await service.captureFinished("inv-1", "failed", { startedAt });
		await service.captureFinished("inv-2", "completed", { startedAt });
		const finished = sent().filter(
			(e) => e.event === "investigation_finished",
		);
		expect(finished).toHaveLength(2);
		expect(propsOf(1)).toMatchObject({
			state: "failed",
			duration_bucket: "1-5m",
			error_class: "harness_unavailable",
		});
		expect(propsOf(2)).toMatchObject({
			state: "completed",
			error_class: "none",
		});
	});

	it("reports a report view once per investigation, not once per poll", async () => {
		const { service, sent } = setup();
		await service.setEnabled(true);
		await service.captureReportViewed("inv-1");
		await service.captureReportViewed("inv-1");
		await service.captureReportViewed("inv-2");
		expect(sent().filter((e) => e.event === "report_viewed")).toHaveLength(2);
	});

	it("reports the first webhook once per install, and remembers it on disk", async () => {
		const { prisma, service, sent } = setup();
		await service.setEnabled(true);
		await service.captureFirstWebhook("prometheus");
		await service.captureFirstWebhook("prometheus");
		await service.captureFirstWebhook("generic");
		expect(
			sent().filter((e) => e.event === "first_webhook_received"),
		).toHaveLength(1);

		// A restart must not re-report it: the marker lives beside the install id.
		const restarted = new TelemetryService(
			prisma as unknown as PrismaService,
			(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
		);
		expect(
			JSON.parse(prisma.rows.get("TELEMETRY")?.value ?? "{}")
				.firstWebhookReported,
		).toBe(true);
		await expect(
			restarted.captureFirstWebhook("generic"),
		).resolves.toBeUndefined();
	});

	it("isEnabled answers before a caller gathers properties", async () => {
		const { service } = setup();
		expect(await service.isEnabled()).toBe(false);
		await service.setEnabled(true);
		expect(await service.isEnabled()).toBe(true);
		vi.stubEnv("PRISMALENS_TELEMETRY", "off");
		expect(await service.isEnabled()).toBe(false);
	});

	it.each([
		["PRISMALENS_TELEMETRY", "off"],
		["DO_NOT_TRACK", "1"],
		["CI", "true"],
	])("%s=%s wins over an opt-in", async (name, value) => {
		const { service, fetchImpl } = setup();
		await service.setEnabled(true);
		fetchImpl.mockClear();
		vi.stubEnv(name, value);
		expect(await service.getSettings()).toMatchObject({
			enabled: false,
			forcedOff: true,
		});
		await service.capture("service_added", { source: "git" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("never throws when the network fails", async () => {
		const { service, fetchImpl } = setup();
		await service.setEnabled(true);
		fetchImpl.mockRejectedValue(new TypeError("fetch failed"));
		await expect(
			service.capture("service_added", { source: "git" }),
		).resolves.toBeUndefined();
	});

	it("derives run_mode from PRISMALENS_RUN_MODE and build from NODE_ENV", async () => {
		const { service, sent, propsOf } = setup();
		await service.setEnabled(true);

		vi.stubEnv("PRISMALENS_RUN_MODE", "electron");
		vi.stubEnv("NODE_ENV", "production");
		await service.capture("report_viewed", {});

		vi.stubEnv("PRISMALENS_RUN_MODE", "something-else");
		vi.stubEnv("NODE_ENV", "development");
		await service.capture("incident_closed", {});

		expect(propsOf(1).run_mode).toBe("electron");
		expect(propsOf(1).build).toBe("release");
		expect(propsOf(2).run_mode).toBe("npm");
		expect(propsOf(2).build).toBe("dev");

		expect(runMode({ PRISMALENS_RUN_MODE: "electron" })).toBe("electron");
		expect(runMode({ PRISMALENS_RUN_MODE: "npm" })).toBe("npm");
		expect(runMode({})).toBe("npm");
		expect(runMode({ PRISMALENS_RUN_MODE: "other" }, "/usr/bin/node")).toBe("npm");
		expect(runMode({ PRISMALENS_INSTALL: "standalone" }, "/x/node")).toBe(
			"installer",
		);
		expect(
			runMode({}, "/opt/homebrew/Cellar/prismalens/0.5.1/libexec/node/bin/node"),
		).toBe("homebrew");
		expect(
			runMode({}, "C:\\Users\\me\\scoop\\apps\\prismalens\\0.5.1\\node\\node.exe"),
		).toBe("scoop");

		expect(build({ NODE_ENV: "production" })).toBe("release");
		expect(build({ NODE_ENV: "development" })).toBe("dev");
		expect(build({})).toBe("dev");
	});

	it("every payload has timestamp equal to UTC midnight of the injected clock", async () => {
		const clockLate = () => new Date("2026-09-25T23:59:59.999Z");
		const lateSetup = setup(clockLate);
		await lateSetup.service.setEnabled(true);
		await lateSetup.service.capture("report_viewed", {});
		const lateEvents = lateSetup.sent();
		expect(lateEvents[0].timestamp).toBe("2026-09-25T00:00:00.000Z");
		expect(lateEvents[1].timestamp).toBe("2026-09-25T00:00:00.000Z");

		const clockEarly = () => new Date("2026-09-26T00:01:00.000Z");
		const earlySetup = setup(clockEarly);
		await earlySetup.service.setEnabled(true);
		await earlySetup.service.capture("report_viewed", {});
		const earlyEvents = earlySetup.sent();
		expect(earlyEvents[0].timestamp).toBe("2026-09-26T00:00:00.000Z");
		expect(earlyEvents[1].timestamp).toBe("2026-09-26T00:00:00.000Z");
	});

	it("sends install_active at most once per UTC day when enabled and not forced off", async () => {
		let currentTime = new Date("2026-09-25T12:00:00.000Z");
		const clock = () => currentTime;
		const { prisma, service, fetchImpl, sent } = setup(clock);

		// Telemetry disabled: bootstrap sends nothing
		await service.onApplicationBootstrap();
		expect(sent()).toHaveLength(0);

		// Telemetry enabled: bootstrap sends install_active
		await service.setEnabled(true);
		fetchImpl.mockClear();
		await service.onApplicationBootstrap();
		expect(sent().filter((e) => e.event === "install_active")).toHaveLength(1);

		// Calling bootstrap again the same UTC day sends nothing
		await service.onApplicationBootstrap();
		expect(sent().filter((e) => e.event === "install_active")).toHaveLength(1);

		// Simulated restart: new service over the same stored row does not send again the same day
		const restarted = new TelemetryService(
			prisma as unknown as PrismaService,
			fetchImpl as unknown as typeof fetch,
			clock,
		);
		await restarted.onApplicationBootstrap();
		expect(sent().filter((e) => e.event === "install_active")).toHaveLength(1);

		// Sent again the next UTC day
		currentTime = new Date("2026-09-26T08:00:00.000Z");
		await restarted.onApplicationBootstrap();
		expect(sent().filter((e) => e.event === "install_active")).toHaveLength(2);

		// Nothing when forced off
		currentTime = new Date("2026-09-27T08:00:00.000Z");
		vi.stubEnv("PRISMALENS_TELEMETRY", "off");
		await restarted.onApplicationBootstrap();
		expect(sent().filter((e) => e.event === "install_active")).toHaveLength(2);

		// Clean up interval
		service.onModuleDestroy();
		restarted.onModuleDestroy();
	});

	it("maintains a recentlySent ring buffer of the last 20 posted payloads without api_key, newest first", async () => {
		const { service, fetchImpl } = setup();
		expect((await service.getSettings()).recentlySent).toEqual([]);

		await service.setEnabled(true); // sends setup_completed
		// setup_completed is in recentlySent
		const initialSettings = await service.getSettings();
		expect(initialSettings.recentlySent).toHaveLength(1);
		expect(initialSettings.recentlySent[0].payload).not.toHaveProperty("api_key");
		expect(initialSettings.recentlySent[0].payload.event).toBe("setup_completed");

		// Send 25 more events
		for (let i = 1; i <= 25; i++) {
			await service.capture("service_added", { source: "local" });
		}

		const settings = await service.getSettings();
		expect(settings.recentlySent).toHaveLength(20);
		for (const entry of settings.recentlySent) {
			expect(entry.payload).not.toHaveProperty("api_key");
			expect(entry.payload).toHaveProperty("event");
			expect(entry.payload).toHaveProperty("distinct_id");
			expect(entry.payload).toHaveProperty("timestamp");
			expect(entry.payload).toHaveProperty("properties");
		}
		// Newest first: the 25th service_added is index 0
		expect(settings.recentlySent[0].payload.event).toBe("service_added");

		// Pushed when fetch is dispatched, even if fetch fails
		fetchImpl.mockRejectedValue(new Error("network failure"));
		await service.capture("incident_closed", {});
		const afterFailed = await service.getSettings();
		expect(afterFailed.recentlySent[0].payload.event).toBe("incident_closed");
	});
});

/**
 * The property that the whole design rests on. One representative value per
 * event, then an assertion over the payload rather than over the source.
 */
describe("no event property is free text", () => {
	const SAMPLES: { [E in TelemetryEvent]: TelemetryEventProps[E] } = {
		setup_completed: {},
		service_added: { source: "local" },
		integration_configured: { kind: "github" },
		first_webhook_received: { provider: "prometheus" },
		investigation_started: { harness: "claude-code", trigger: "manual" },
		investigation_finished: {
			state: "failed",
			duration_bucket: ">15m",
			error_class: "timeout",
		},
		report_viewed: {},
		// Wired at both call sites since #661 merged: the Markdown export route
		// and the Slack delivery attempt.
		report_exported: { target: "markdown" },
		incident_closed: {},
		install_active: {},
	};

	/**
	 * The only strings not drawn from a closed enum. Both are this build's own
	 * version, fixed at compile time — not anything read from the install.
	 */
	const VERSION_FIELDS = ["app_version", "$lib_version"];
	const LIB_FIELDS = ["$lib"];

	it("covers every event in the taxonomy", () => {
		expect(Object.keys(SAMPLES).sort()).toEqual(
			[
				"first_webhook_received",
				"incident_closed",
				"install_active",
				"integration_configured",
				"investigation_finished",
				"investigation_started",
				"report_exported",
				"report_viewed",
				"service_added",
				"setup_completed",
			].sort(),
		);
	});

	it("sends only enums, buckets, booleans and bounded numbers", async () => {
		const { service, sent } = setup();
		await service.setEnabled(true);
		for (const [event, props] of Object.entries(SAMPLES)) {
			await service.capture(
				event as TelemetryEvent,
				props as TelemetryEventProps[TelemetryEvent],
			);
		}
		const events = sent();
		expect(events.length).toBeGreaterThanOrEqual(
			Object.keys(SAMPLES).length,
		);
		for (const payload of events) {
			const props = payload.properties as Record<string, unknown>;
			for (const [key, value] of Object.entries(props)) {
				if (typeof value === "boolean") continue;
				if (VERSION_FIELDS.includes(key)) {
					expect(typeof value).toBe("string");
					continue;
				}
				if (LIB_FIELDS.includes(key)) {
					expect(value).toBe("prismalens-api");
					continue;
				}
				const allowed = ALLOWED_PROPERTY_VALUES[key];
				expect(
					allowed,
					`property "${key}" is not declared in ALLOWED_PROPERTY_VALUES`,
				).toBeDefined();
				if (allowed === "number") {
					expect(Number.isInteger(value)).toBe(true);
					continue;
				}
				expect(
					allowed as readonly unknown[],
					`property "${key}" carried an undeclared value`,
				).toContain(value);
			}
		}
	});

	it("drops an undeclared property or value rather than sending it", () => {
		expect(
			sanitize({
				source: "local",
				// A call site that tried to smuggle content through:
				repo_name: "acme/payments",
				error_class: "a raw error message",
				harness: "some-new-harness",
			}),
		).toEqual({ source: "local" });
	});

	it("declares only closed sets, so a value can never be arbitrary", () => {
		for (const [key, allowed] of Object.entries(ALLOWED_PROPERTY_VALUES)) {
			if (allowed === "number") continue;
			expect(Array.isArray(allowed), `${key} must be a closed set`).toBe(true);
			expect((allowed as readonly unknown[]).length).toBeGreaterThan(0);
		}
	});
});

describe("buckets and classes", () => {
	it("buckets a duration into one of four ranges", () => {
		expect(durationBucket(0)).toBe("<1m");
		expect(durationBucket(59_999)).toBe("<1m");
		expect(durationBucket(60_000)).toBe("1-5m");
		expect(durationBucket(5 * 60_000 - 1)).toBe("1-5m");
		expect(durationBucket(5 * 60_000)).toBe("5-15m");
		expect(durationBucket(15 * 60_000)).toBe(">15m");
		// An unknown start time is not a fingerprint either.
		expect(durationBucket(Number.NaN)).toBe("<1m");
		expect(DURATION_BUCKETS).toContain(durationBucket(1));
	});

	it("reduces an error to a class and never carries its text", () => {
		expect(classifyError("completed", null)).toBe("none");
		expect(classifyError("cancelled", "anything")).toBe("cancelled");
		expect(classifyError("failed", "spawn claude ENOENT")).toBe(
			"harness_unavailable",
		);
		expect(classifyError("failed", "Request timed out after 300s")).toBe(
			"timeout",
		);
		expect(classifyError("failed", "fatal: could not clone repository")).toBe(
			"repo_unavailable",
		);
		expect(classifyError("failed", "401 Unauthorized")).toBe("auth");
		expect(classifyError("failed", "connect ECONNREFUSED 127.0.0.1")).toBe(
			"network",
		);
		expect(classifyError("failed", "process exited with code 2")).toBe(
			"harness_exited",
		);
		expect(
			classifyError("failed", "something nobody has seen before"),
		).toBe("other");
		for (const text of ["", null, undefined]) {
			expect(ERROR_CLASSES).toContain(classifyError("failed", text));
		}
	});

	it("maps a trigger type to how the run was asked for", () => {
		expect(triggerFor("manual")).toBe("manual");
		expect(triggerFor("auto_critical")).toBe("webhook");
		expect(triggerFor("auto_tier")).toBe("webhook");
		expect(triggerFor("alert_threshold")).toBe("webhook");
		// Neither, rather than mislabelled as a webhook.
		expect(triggerFor("scheduled")).toBe("other");
		expect(triggerFor(null)).toBe("other");
	});

	it("reduces an integration template to its vendor", () => {
		expect(integrationKindFor("github-app")).toBe("github");
		expect(integrationKindFor("github-token")).toBe("github");
		expect(integrationKindFor("render")).toBe("render");
		expect(integrationKindFor("slack-webhook")).toBe("slack");
		expect(integrationKindFor("some-vendor-nobody-shipped")).toBe("other");
	});

	it("only ever names a harness this build knows", () => {
		expect(ALLOWED_PROPERTY_VALUES.harness).toEqual([...HARNESS_IDS, null]);
	});
});

describe("telemetryForcedOff", () => {
	it("reads off, 0 and false", () => {
		for (const v of ["off", "0", "false", "OFF"]) {
			expect(telemetryForcedOff({ PRISMALENS_TELEMETRY: v })).toBe(true);
		}
		expect(telemetryForcedOff({})).toBe(false);
		expect(telemetryForcedOff({ PRISMALENS_TELEMETRY: "on" })).toBe(false);
	});

	it("honours DO_NOT_TRACK, but only when it is actually set", () => {
		expect(telemetryForcedOff({ DO_NOT_TRACK: "1" })).toBe(true);
		expect(telemetryForcedOff({ DO_NOT_TRACK: "true" })).toBe(true);
		expect(telemetryForcedOff({ DO_NOT_TRACK: "0" })).toBe(false);
		expect(telemetryForcedOff({ DO_NOT_TRACK: "" })).toBe(false);
	});

	it("is off in CI, which cannot consent", () => {
		expect(telemetryForcedOff({ CI: "true" })).toBe(true);
		expect(telemetryForcedOff({ CI: "1" })).toBe(true);
		expect(telemetryForcedOff({ CI: "" })).toBe(false);
	});
});
