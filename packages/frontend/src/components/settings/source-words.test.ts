// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView, SourceRow } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { envTokenChange, originOf } from "./ConnectionFormDialog";
import { probeWord } from "./SourceConnectDialog";
import {
	credentialWord,
	hostCredentialWord,
	hostState,
	sourceState,
	tokenState,
} from "./source-words";

describe("source words and states (#848 Sources)", () => {
	it("derives credential words for stored, env, and none (case 4)", () => {
		expect(
			credentialWord({ credential: "stored", credentialKind: "bearer" }),
		).toBe("Set in PrismaLens");
		expect(
			credentialWord({ credential: "stored", credentialKind: "none" }),
		).toBe("No credential");
		expect(credentialWord({ credential: "env" })).toBe(
			"From environment",
		);
		expect(credentialWord({ credential: "none" })).toBe(
			"Not set",
		);
	});

	it("computes envTokenChange against env origin (case 5)", () => {
		expect(originOf("https://h:9090/path")).toBe("https://h:9090");
		expect(originOf("invalid-url")).toBeNull();

		// stops when moving off env origin
		expect(
			envTokenChange(
				"https://h:9090",
				"http://h:9090",
				"https://h:9090",
			),
		).toBe("stops");
		// same origin is null
		expect(
			envTokenChange(
				"https://h:9090",
				"https://h:9090/sub",
				"https://h:9090",
			),
		).toBeNull();
		// different port is stops
		expect(
			envTokenChange(
				"https://h:9090",
				"https://h:9091",
				"https://h:9090",
			),
		).toBe("stops");
		// moving onto env origin is starts
		expect(
			envTokenChange(
				"http://h:9090",
				"https://h:9090",
				"https://h:9090",
			),
		).toBe("starts");
	});

	it("formats probeWord correctly (case 6)", () => {
		const baseProbe = {
			type: "prometheus",
			host: "localhost",
			probes: [],
			discovered: {},
		};
		expect(probeWord({ ...baseProbe, ok: true, untested: false })).toEqual({
			text: "Connected",
			tone: "ok",
		});
		expect(probeWord({ ...baseProbe, ok: false, untested: true })).toEqual({
			text: "Not tested yet",
			tone: "neutral",
		});
		expect(probeWord({ ...baseProbe, ok: false, untested: false })).toEqual({
			text: "Failed",
			tone: "danger",
		});
	});

	it("derives sourceState and tokenState for tested and untested rows (case 6)", () => {
		expect(
			sourceState({
				status: "ACTIVE",
				testedAt: null,
				problem: null,
			}),
		).toEqual({ text: "Not tested yet", tone: "neutral" });

		expect(
			sourceState({
				status: "ACTIVE",
				testedAt: "2026-10-25T00:00:00Z",
				problem: null,
			}),
		).toEqual({ text: "Connected", tone: "ok" });

		expect(
			tokenState({
				status: "ACTIVE",
				testedAt: null,
			}),
		).toEqual({ text: "Not tested yet", tone: "neutral" });

		const hostUntested: GitHostView = {
			host: "github.com",
			order: ["stored"],
			ambiguous: false,
			stored: [
				{
					connectionId: "c1",
					label: "token 1",
					fingerprint: "fp1",
					status: "ACTIVE",
					testedAt: null,
					pinnedRepos: [],
				},
			],
			env: null,
			machine: null,
			unpinnedRepos: [],
		};
		expect(hostState(hostUntested)).toEqual({
			text: "Not tested yet",
			tone: "neutral",
		});
	});

	it("derives problem words (case 7)", () => {
		const row = (p: Partial<SourceRow>): Pick<SourceRow, "status" | "testedAt" | "problem"> => ({
			status: "ERROR",
			testedAt: null,
			problem: null,
			...p,
		});

		expect(sourceState(row({ problem: "credential-refused" }))).toEqual({
			text: "Credential refused",
			tone: "warn",
		});
		expect(sourceState(row({ problem: "cant-reach" }))).toEqual({
			text: "Can't reach",
			tone: "warn",
		});
		expect(sourceState(row({ problem: "needs-credential" }))).toEqual({
			text: "Needs a credential",
			tone: "warn",
		});
		expect(sourceState(row({ status: "TOKEN_EXPIRED" }))).toEqual({
			text: "Expired",
			tone: "warn",
		});
		expect(sourceState(row({ status: "ERROR" }))).toEqual({
			text: "Problem",
			tone: "warn",
		});
	});

	it("returns Pick a token when git host is ambiguous (case 8)", () => {
		const ambiguousHost: GitHostView = {
			host: "github.com",
			order: ["stored"],
			ambiguous: true,
			stored: [],
			env: null,
			machine: null,
			unpinnedRepos: [],
		};
		expect(hostState(ambiguousHost)).toEqual({
			text: "Pick a token",
			tone: "warn",
		});
	});
});
