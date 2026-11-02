// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Repository as PrismaRepository } from "@prismalens/database";
import { describe, expect, it } from "vitest";
import { serializeRepository } from "./serialize-repository.js";

const SENTINEL = "ghp_SENTINEL938";

function row(url: string, sourceKind = "url", fullName = "acme/api"): PrismaRepository {
	const at = new Date("2026-10-01T00:00:00Z");
	return {
		id: "repo-1",
		url,
		sourceKind,
		fullName,
		createdAt: at,
		updatedAt: at,
		syncedAt: null,
		metadata: null,
	} as unknown as PrismaRepository;
}

const credentialFor = async () => ({ source: "none" as const, label: "public", via: "none" });

describe("serializeRepository legacy rows (#938)", () => {
	it.each([
		`git@github.com:acme/api.git?token=${SENTINEL}`,
		`git+https://u:${SENTINEL}@git.example/x`,
		`git+https://${SENTINEL}@git.example/x`,
	])("%s comes back without the credential", async (url) => {
		const out = await serializeRepository(row(url), credentialFor);
		expect(JSON.stringify(out)).not.toContain(SENTINEL);
	});

	it("a root address whose fullName was the address itself comes back without it", async () => {
		const url = `https://github.com/?token=${SENTINEL}`;
		const out = await serializeRepository(row(url, "url", url), credentialFor);
		expect(JSON.stringify(out)).not.toContain(SENTINEL);
	});

	it("a clean row keeps its fullName", async () => {
		const out = await serializeRepository(row("https://github.com/acme/api.git"), credentialFor);
		expect(out.fullName).toBe("acme/api");
	});
});
