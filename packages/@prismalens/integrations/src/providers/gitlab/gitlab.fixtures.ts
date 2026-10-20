// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Shapes follow https://docs.gitlab.com/api/projects/, /api/commits/, /api/repository_files/, /api/groups/ and /api/users/.
export const user = {
	id: 1,
	username: "ada",
	name: "Ada Lovelace",
	avatar_url: "https://gitlab.example/uploads/ada.png",
};

export const groups = [
	{
		id: 7,
		full_path: "acme",
		name: "Acme",
		avatar_url: null,
		description: "Platform",
	},
];

const project = (id: number, path: string, visibility: string) => ({
	id,
	name: path.split("/").pop(),
	path_with_namespace: path,
	description: null,
	star_count: 2,
	default_branch: "main",
	visibility,
	web_url: `https://gitlab.example/${path}`,
	http_url_to_repo: `https://gitlab.example/${path}.git`,
	last_activity_at: "2026-10-01T10:00:00.000Z",
});

export const projectsPage1 = [project(11, "acme/api", "private")];
export const projectsPage2 = [project(12, "acme/platform/web", "public")];

export const MERGE_SHA = "c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2";

export const commits = [
	{
		id: MERGE_SHA,
		parent_ids: [
			"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
			"b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1",
		],
		committed_date: "2026-10-02T09:30:00.000+00:00",
		author_name: "Ada Lovelace",
		title: "Merge branch 'fix-timeout' into 'main'",
		message:
			"Merge branch 'fix-timeout' into 'main'\n\nRaise the db timeout\n\nSee merge request acme/api!42",
	},
];

export const diff = [
	{ old_path: "src/db.ts", new_path: "src/db.ts" },
	{ old_path: "old.md", new_path: "docs/new.md" },
];

export const file = {
	file_path: "docs/runbook.md",
	encoding: "base64",
	content: Buffer.from("# Runbook\n").toString("base64"),
	blob_id: "deadbeef",
	size: 10,
};
