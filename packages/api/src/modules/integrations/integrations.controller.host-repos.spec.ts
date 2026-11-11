// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ModuleRef } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { ImagesService } from "../images/images.service.js";
import type { GitCredentialService } from "./git-credential.service.js";
import type { HostRepositoriesService } from "./host-repositories.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import type { IntegrationsService } from "./integrations.service.js";

type Callable = {
	"~orpc": { handler: (o: { input: unknown; context: unknown }) => unknown };
};

const repo = (name: string, avatar?: string) => ({
	fullName: name,
	url: `https://github.com/${name}.git`,
	private: false,
	pushedAt: null,
	ownerAvatarUrl: avatar,
});

function setup(urlFor: (u: string | undefined) => string | undefined) {
	const hostRepositories = {
		list: vi.fn(async () => ({
			credential: "resolved" as const,
			hasMore: false,
			repositories: [
				repo("acme/shop", "https://avatars.githubusercontent.com/u/1"),
				repo("acme/odd", "https://tracker.example/a.png"),
				repo("acme/none"),
			],
		})),
	};
	const images = { urlFor: vi.fn(urlFor) };
	const controller = new IntegrationsController(
		{} as IntegrationsService,
		{} as GitCredentialService,
		{} as ModuleRef,
		undefined,
		undefined,
		hostRepositories as unknown as HostRepositoriesService,
		images as unknown as ImagesService,
	);
	const route = controller.sourcesHostRepositories() as unknown as Callable;
	return { route, images };
}

describe("sources.hostRepositories avatars (#1091)", () => {
	it("returns proxied avatar URLs, and drops one the proxy will not serve", async () => {
		const { route, images } = setup((u) =>
			u?.startsWith("https://avatars.githubusercontent.com/")
				? "/api/images/signed-1"
				: undefined,
		);
		const got = (await route["~orpc"].handler({
			input: { host: "github.com" },
			context: {},
		})) as { repositories: { fullName: string; ownerAvatarUrl?: string }[] };

		expect(
			got.repositories.map((r) => [r.fullName, r.ownerAvatarUrl]),
		).toEqual([
			["acme/shop", "/api/images/signed-1"],
			["acme/odd", undefined],
			["acme/none", undefined],
		]);
		expect(images.urlFor).toHaveBeenCalledWith(
			"https://avatars.githubusercontent.com/u/1",
			"avatar",
			{ fromHostApi: true },
		);
	});

	it("sends no avatar at all while Images from the git host is off", async () => {
		const { route } = setup(() => undefined);
		const got = (await route["~orpc"].handler({
			input: { host: "github.com" },
			context: {},
		})) as { repositories: { ownerAvatarUrl?: string }[] };

		expect(got.repositories.map((r) => r.ownerAvatarUrl)).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});
});
