// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Shapes follow https://developer.atlassian.com/cloud/bitbucket/rest/api-group-repositories/,
// .../api-group-commits/, .../api-group-workspaces/ and .../api-group-users/.
export const user = {
	uuid: "{u-1}",
	nickname: "ada",
	display_name: "Ada Lovelace",
	links: { avatar: { href: "https://bitbucket.example/ada.png" } },
};

export const workspaces = {
	values: [{ uuid: "{w-1}", slug: "acme", name: "Acme" }],
};

const repo = (slug: string, isPrivate: boolean) => ({
	uuid: `{${slug}}`,
	name: slug,
	full_name: `acme/${slug}`,
	description: "",
	language: "typescript",
	is_private: isPrivate,
	mainbranch: { name: "main" },
	updated_on: "2026-10-01T10:00:00.000000+00:00",
	links: {
		html: { href: `https://bitbucket.org/acme/${slug}` },
		clone: [
			{ name: "https", href: `https://ada@bitbucket.org/acme/${slug}.git` },
			{ name: "ssh", href: `git@bitbucket.org:acme/${slug}.git` },
		],
	},
});

export const repos = (origin: string) => ({
	page1: {
		values: [repo("api", true)],
		next: `${origin}/2.0/repositories?role=member&pagelen=100&page=2`,
	},
	page2: { values: [repo("web", false)] },
});

const commit = (
	hash: string,
	date: string,
	parents: string[],
	message: string,
) => ({
	hash,
	date,
	message,
	author: {
		raw: "Ada <ada@example.com>",
		user: { display_name: "Ada Lovelace" },
	},
	parents: parents.map((h) => ({ hash: h })),
});

export const commitsNewestFirst = [
	commit(
		"c3",
		"2026-10-03T09:00:00+00:00",
		["c2"],
		"Fix timeout\n\nRaise it to 30s",
	),
	commit("c2", "2026-10-02T09:00:00+00:00", ["c1"], "Add retry"),
	commit("c1", "2026-09-01T09:00:00+00:00", [], "Old"),
];

export const diffstat = {
	values: [
		{
			status: "modified",
			new: { path: "src/db.ts" },
			old: { path: "src/db.ts" },
		},
		{ status: "removed", new: null, old: { path: "gone.md" } },
	],
};
