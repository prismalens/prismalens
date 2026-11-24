// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { GitCredential } from "../../core/harness/git-credential.js";
import {
	GitCredentialAmbiguousError,
	type GitCredentialService,
} from "./git-credential.service.js";
import {
	HostListingError,
	HostRepositoriesService,
} from "./host-repositories.service.js";

const stored = (host: string) =>
	new GitCredential({ source: "connection", label: "work", via: "header" } as never, "tok-123", { host });
const machine = () => new GitCredential({ source: "machine", label: "helper", via: "helper" } as never);

function service(cred: () => GitCredential | Promise<GitCredential>, body: unknown = []) {
	const credentials = {
		resolveForUse: vi.fn(async () => cred()),
		tokenFor: vi.fn(async (_url: string, id: string) => id === "c2" ? {} : null),
	} as unknown as GitCredentialService;
	const s = new HostRepositoriesService(credentials);
	const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)));
	s.fetchImpl = fetchImpl as never;
	return { s, fetchImpl, credentials };
}

describe("HostRepositoriesService", () => {
	it("lists with the stored token, sent only to the host's API", async () => {
		const { s, fetchImpl } = service(() => stored("github.com"), [
			{ full_name: "acme/app", clone_url: "https://github.com/acme/app.git", private: true, pushed_at: "2026-11-01T00:00:00Z" },
		]);
		const page = await s.list({ host: "github.com" });
		expect(page).toMatchObject({ credential: "resolved", repositories: [{ fullName: "acme/app", private: true }] });
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toMatch(/^https:\/\/api\.github\.com\/user\/repos\?/);
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-123");
	});

	it("says there is no credential when only the machine's git or nothing would clone", async () => {
		const { s, fetchImpl } = service(machine);
		expect(await s.list({ host: "gitlab.example.com" })).toEqual({ credential: "none", repositories: [], hasMore: false });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("requires an explicit saved token when discovery is ambiguous", async () => {
		const { s, fetchImpl, credentials } = service(() => stored("bitbucket.org"), { values: [] });
		vi.mocked(credentials.resolveForUse).mockRejectedValueOnce(new GitCredentialAmbiguousError("bitbucket.org", []));
		const input = { host: "bitbucket.org", workspace: "acme" };
		await expect(s.list(input)).rejects.toThrow("Choose a saved token");
		await expect(s.list({ ...input, credentialConnectionId: "other" })).rejects.toThrow("Choose a saved token");
		expect(fetchImpl).not.toHaveBeenCalled();
		expect((await s.list({ ...input, credentialConnectionId: "c2" })).credential).toBe("resolved");
		expect(credentials.tokenFor).toHaveBeenLastCalledWith("https://bitbucket.org/_/_", "c2");
		expect(credentials.resolveForUse).toHaveBeenLastCalledWith(expect.objectContaining({ pick: "c2" }));
	});

	it("uses the Atlassian email for a saved Bitbucket personal API token", async () => {
		const credential = new GitCredential(stored("bitbucket.org").display, "test-token", {
			host: "bitbucket.org",
			apiUsername: "user@example.com",
		});
		const { s, fetchImpl } = service(() => credential, { values: [] });
		await s.list({ host: "bitbucket.org", workspace: "acme", credentialConnectionId: "c2" });
		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(new Headers(init.headers).get("authorization")).toBe(
			`Basic ${Buffer.from("user@example.com:test-token").toString("base64")}`,
		);
	});

	it("passes a host's refusal on, and refuses a non-host", async () => {
		const { s, fetchImpl } = service(() => stored("gitlab.example.com"));
		fetchImpl.mockResolvedValueOnce(new Response("", { status: 403 }));
		await expect(s.list({ host: "gitlab.example.com" })).rejects.toBeInstanceOf(HostListingError);
		await expect(s.list({ host: "not a host/../x" })).rejects.toBeInstanceOf(HostListingError);
	});
});
