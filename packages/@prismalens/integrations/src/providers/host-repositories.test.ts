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
			"https://api.github.com/user/repos?per_page=100&page=2&sort=pushed&direction=desc&affiliation=owner%2Ccollaborator%2Corganization_member",
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

	it("a GitHub search filters the repos the token can see, never all of GitHub", async () => {
		const get = vi.fn(async () => fixture("github-user-repos.json"));
		const page = await listHostRepositories("github", "github.com", get, { search: "CHECKOUT" });
		expect(get).toHaveBeenCalledOnce();
		expect(get).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/api\.github\.com\/user\/repos\?per_page=100&page=1/));
		expect(page.repositories.map((r) => r.fullName)).toEqual(["acme/checkout-api"]);
		expect(page.hasMore).toBe(false);
	});

	it("a GitHub search reads up to three full pages and pages the matches", async () => {
		const row = (n: number) => ({
			full_name: `acme/svc-${n}`,
			clone_url: `https://github.com/acme/svc-${n}.git`,
			pushed_at: null,
		});
		const get = vi.fn(async (url: string) => {
			const page = Number(new URL(url).searchParams.get("page"));
			return Array.from({ length: 100 }, (_, i) => row((page - 1) * 100 + i));
		});
		const first = await listHostRepositories("github", "github.com", get, { search: "svc" });
		expect(get).toHaveBeenCalledTimes(3);
		expect(first.repositories).toHaveLength(30);
		expect(first.hasMore).toBe(true);
		const last = await listHostRepositories("github", "github.com", get, { search: "svc", page: 10 });
		expect(last.repositories.map((r) => r.fullName)).toEqual(Array.from({ length: 30 }, (_, i) => `acme/svc-${270 + i}`));
		expect(last.hasMore).toBe(false);
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
