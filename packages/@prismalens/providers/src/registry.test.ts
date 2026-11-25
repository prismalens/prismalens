// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { collect, formatProblems, type Manifest, runGuards } from "@prismalens/registry";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineEntryPoint, defineProvider, type ProviderDef, secret, secretFields } from "./descriptor.ts";
import { kinds } from "./kinds/index.ts";
import { ProviderRegistry } from "./registry.ts";

const host = (id: `code-host.${string}`, order: number, extra: Partial<ProviderDef<"code-host">> = {}) =>
	defineProvider({
		id,
		family: "code-host",
		name: id.split(".")[1] ?? id,
		mark: { letters: "FX" },
		order,
		entryPoints: [],
		...extra,
	});

describe("ProviderRegistry", () => {
	it("lists the built-in members and two modules' contributions in declared order", () => {
		const r = new ProviderRegistry({ "src/code-host/b.provider.ts": { b: host("code-host.beta", 20) } });
		r.contribute("module-one", [host("code-host.alpha", 10)]);
		r.contribute("module-two", [host("code-host.gamma", 30)]);
		expect(r.list("code-host").map((p) => p.id)).toEqual(["code-host.alpha", "code-host.beta", "code-host.gamma"]);
		expect(r.list("agent")).toEqual([]);
	});

	it("refuses a duplicate id, naming both modules", () => {
		const r = new ProviderRegistry({});
		r.contribute("module-one", [host("code-host.alpha", 10)]);
		expect(() => r.contribute("module-two", [host("code-host.alpha", 20)])).toThrow(
			"duplicate provider code-host.alpha from module-two (already from module-one)",
		);
	});

	it("refuses an id another member holds as an alias, naming that member's module", () => {
		const r = new ProviderRegistry({});
		r.contribute("module-one", [host("code-host.alpha", 10, { aliases: ["code-host.old-alpha"] })]);
		expect(() => r.contribute("module-two", [host("code-host.old-alpha", 20)])).toThrow(
			"duplicate provider code-host.old-alpha from module-two (already from module-one)",
		);
	});

	it("resolves an alias to its member and an unknown stored id to unavailable, keeping the id", () => {
		const r = new ProviderRegistry({});
		r.contribute("m", [host("code-host.alpha", 10, { aliases: ["code-host.old-alpha"] })]);
		const old = r.resolve("code-host.old-alpha");
		expect(old.ok && old.provider.id).toBe("code-host.alpha");
		expect(r.resolve("code-host.removed")).toEqual({
			ok: false,
			id: "code-host.removed",
			reason: "No installed module provides code-host.removed; its saved settings are kept.",
		});
	});

	it("refuses a member of an unknown family", () => {
		const r = new ProviderRegistry({});
		const bad = { ...host("code-host.alpha", 10), family: "ticketing" } as unknown as ProviderDef;
		expect(() => r.contribute("m", [bad])).toThrow("provider code-host.alpha from m names unknown family ticketing");
	});
});

/** Runs the provider host's guards over live entries, the way `registry gen` does. */
function guardsOver(modules: Record<string, Record<string, unknown>>): string[] {
	const live = collect(kinds, modules);
	const entries = (k: string) =>
		Array.from(live.of(k).values()).map((e) => ({ id: e.id, file: live.fileOf(k, e.id) ?? "", export: e.id, fields: {} }));
	const manifest: Manifest = {
		version: 1,
		kinds: Object.fromEntries(
			kinds.map((k) => [k.name, { file: "", suffix: k.suffix, about: k.about, refs: k.refs, guards: k.guards.map((g) => g.name), aliases: [], keywords: k.keywords }]),
		),
		entries: { provider: entries("provider"), entryPoint: entries("entryPoint") },
		gallery: [],
		uses: {},
	};
	return formatProblems(runGuards(kinds, manifest, live)).filter((p) => !p.includes("/fresh]"));
}

const point = defineEntryPoint({
	id: "projects.add",
	family: "code-host",
	required: true,
	about: "Add project",
	screen: "packages/frontend/src/components/projects/AddProjectDialog.tsx",
});

describe("provider guards", () => {
	it("pass a member that offers its family's required entry point", () => {
		expect(
			guardsOver({
				"src/x.entry-points.ts": { point },
				"src/a.provider.ts": { a: host("code-host.alpha", 10, { entryPoints: ["projects.add"] }) },
			}),
		).toEqual([]);
	});

	it("accept a named skip instead of the entry point", () => {
		const skipped = host("code-host.alpha", 10, { skips: [{ case: "entry-point:projects.add", reason: "no repositories to add" }] });
		expect(guardsOver({ "src/x.entry-points.ts": { point }, "src/a.provider.ts": { skipped } })).toEqual([]);
	});

	it("name a shared order, a bad id and a missing entry point", () => {
		expect(
			guardsOver({
				"src/x.entry-points.ts": { point },
				"src/a.provider.ts": {
					a: host("code-host.alpha", 10, { entryPoints: ["projects.add"] }),
					b: host("code-host.beta", 10, { entryPoints: ["projects.add"] }),
					c: host("code-host.Bad_Name" as `code-host.${string}`, 30, { entryPoints: ["projects.add"] }),
					d: host("code-host.delta", 40),
					e: host("code-host.epsilon", 10, { entryPoints: ["projects.add"] }),
				},
			}),
		).toEqual([
			'[provider/id-in-family] provider "code-host.Bad_Name" is not "code-host.<member>". Fix: Name it <family>.<member> with a lower-case member, e.g. code-host.gitea.',
			'[provider/order-unique] provider "code-host.beta" and "code-host.alpha" share order 10. Fix: Give each member of a family its own order; new members take the family\'s highest plus 10.',
			'[provider/order-unique] provider "code-host.epsilon" and "code-host.alpha" share order 10. Fix: Give each member of a family its own order; new members take the family\'s highest plus 10.',
			'[provider/entry-point-required] code-host.delta misses projects.add. Fix: Add the entry point to the provider\'s entryPoints, or a skip { case: "entry-point:<id>", reason } saying why it cannot be offered there.',
		]);
	});

	it("refuse a secret in config and a secret wrapped so redaction cannot see it", () => {
		const leaky = host("code-host.alpha", 10, {
			config: z.object({ token: secret({ title: "Token" }) }),
			auth: {
				schemes: [
					{
						id: "api-token",
						label: "API token",
						apply: { bearer: "{token}" },
						fields: { token: secret({ title: "Token" }).optional() },
					},
				],
			},
		});
		expect(guardsOver({ "src/a.provider.ts": { leaky } }).filter((p) => p.includes("secret-fields"))).toEqual([
			'[provider/secret-fields] provider "code-host.alpha" config declares a secret field. Fix: Declare a credential with secret() directly in an auth scheme\'s fields; keep config free of secrets.',
			"[provider/secret-fields] provider \"code-host.alpha\" scheme api-token field token is marked secret but not built with secret() (wrapped or nested). Fix: Declare a credential with secret() directly in an auth scheme's fields; keep config free of secrets.",
		]);
	});
});

describe("secretFields", () => {
	it("lists exactly the fields built with secret(), by scheme", () => {
		const p = host("code-host.alpha", 10, {
			auth: {
				schemes: [
					{
						id: "api-token",
						label: "API token",
						apply: { basic: { user: "{email}", password: "{token}" } },
						fields: { email: z.email(), token: secret({ title: "API token" }) },
					},
					{ id: "access-token", label: "Access token", apply: { bearer: "{token}" }, fields: { token: secret({ title: "Access token" }) } },
				],
			},
		});
		expect(secretFields(p)).toEqual(["api-token.token", "access-token.token"]);
	});
});
