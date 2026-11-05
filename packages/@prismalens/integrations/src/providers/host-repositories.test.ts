// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	gitHostKind,
	hostApiBase,
	hostRepositoriesUrl,
	listHostRepositories,
} from "./host-repositories.js";

const fixture = (name: string): unknown =>
	JSON.parse(
		readFileSync(join(__dirname, "__fixtures__", "host-repositories", name), "utf8"),
	);

describe("gitHostKind and hostApiBase", () => {
	it("names the host and its API root", () => {
		expect(gitHostKind("github.com")).toBe("github");
		expect(gitHostKind("ghe.corp.example", ["ghe.corp.example"])).toBe("github");
		expect(gitHostKind("bitbucket.org")).toBe("bitbucket");
		expect(gitHostKind("gitlab.example.com")).toBe("gitlab");
		expect(hostApiBase("github", "github.com")).toBe("https://api.github.com");
		expect(hostApiBase("github", "ghe.corp.example")).toBe("https://ghe.corp.example/api/v3");
		expect(hostApiBase("gitlab", "gitlab.example.com")).toBe("https://gitlab.example.com/api/v4");
		expect(hostApiBase("bitbucket", "bitbucket.org")).toBe("https://api.bitbucket.org/2.0");
	});
});

describe("hostRepositoriesUrl", () => {
	it("asks each host for the newest pushes first, and searches by name", () => {
		expect(hostRepositoriesUrl("github", "https://api.github.com", {})).toBe(
			"https://api.github.com/user/repos?per_page=30&page=1&sort=pushed&direction=desc&affiliation=owner%2Ccollaborator%2Corganization_member",
		);
		expect(
			hostRepositoriesUrl("github", "https://api.github.com", { search: "checkout", page: 2 }),
		).toBe(
			"https://api.github.com/search/repositories?per_page=30&page=2&q=checkout+in%3Aname&sort=updated",
		);
		expect(
			hostRepositoriesUrl("gitlab", "https://gitlab.example.com/api/v4", { search: "inv" }),
		).toBe(
			"https://gitlab.example.com/api/v4/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=30&page=1&search=inv",
		);
		expect(
			hostRepositoriesUrl("bitbucket", "https://api.bitbucket.org/2.0", { search: 'bill"ing' }),
		).toBe(
			"https://api.bitbucket.org/2.0/repositories?role=member&sort=-updated_on&pagelen=30&page=1&q=name+%7E+%22billing%22",
		);
	});
});

describe("listHostRepositories against recorded answers", () => {
	it("GitHub /user/repos: an http avatar and a row without a clone URL are dropped", async () => {
		const get = vi.fn(async () => fixture("github-user-repos.json"));
		const page = await listHostRepositories("github", "github.com", get);
		expect(get).toHaveBeenCalledWith(expect.stringContaining("https://api.github.com/user/repos?"));
		expect(page.hasMore).toBe(false);
		expect(page.repositories).toEqual([
			{
				fullName: "acme/checkout-api",
				url: "https://github.com/acme/checkout-api.git",
				private: true,
				pushedAt: "2026-11-05T18:21:09Z",
				description: "Payments and carts",
				ownerAvatarUrl: "https://avatars.githubusercontent.com/u/9919?v=4",
			},
			{
				fullName: "octo/dotfiles",
				url: "https://github.com/octo/dotfiles.git",
				private: false,
				pushedAt: "2026-10-30T09:00:00Z",
				description: undefined,
				ownerAvatarUrl: undefined,
			},
		]);
	});

	it("GitHub /search/repositories", async () => {
		const page = await listHostRepositories(
			"github",
			"github.com",
			async () => fixture("github-search.json"),
			{ search: "checkout" },
		);
		expect(page.repositories.map((r) => r.fullName)).toEqual(["acme/checkout-web"]);
	});

	it("GitLab /projects, with a relative avatar made absolute on the host", async () => {
		const page = await listHostRepositories(
			"gitlab",
			"gitlab.example.com",
			async () => fixture("gitlab-projects.json"),
		);
		expect(page.repositories[0]).toEqual({
			fullName: "platform/inventory",
			url: "https://gitlab.example.com/platform/inventory.git",
			private: true,
			pushedAt: "2026-11-04T12:00:00.000Z",
			description: "Inventory service",
			ownerAvatarUrl: "https://gitlab.example.com/uploads/-/system/group/avatar/9/logo.png",
		});
		expect(page.repositories[1]).toMatchObject({ private: false, description: undefined });
	});

	it("Bitbucket /repositories, without the user name in the clone URL", async () => {
		const page = await listHostRepositories(
			"bitbucket",
			"bitbucket.org",
			async () => fixture("bitbucket-repositories.json"),
		);
		expect(page.hasMore).toBe(true);
		expect(page.repositories).toEqual([
			{
				fullName: "acme-team/billing",
				url: "https://bitbucket.org/acme-team/billing.git",
				private: true,
				pushedAt: "2026-11-03T08:30:00.000000+00:00",
				description: "Invoices",
				ownerAvatarUrl: "https://bitbucket.org/account/acme-team/avatar/",
			},
		]);
	});
});
