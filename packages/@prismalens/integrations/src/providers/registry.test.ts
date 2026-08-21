// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	adapterCapabilities,
	adapterSegments,
	createAdapter,
	getAdapterCapabilities,
	getAdapterSegments,
	getTemplatesForCapability,
	getTemplatesForSegment,
	GitHubAdapter,
	isAdapterSupported,
	RenderAdapter,
	templatesForCapability,
	templatesForSegment,
	VercelAdapter,
} from "./index.js";

describe("Exact-templateId Adapter Registry (#446)", () => {
	it("resolves both github-app and github-token to GitHubAdapter", () => {
		const appAdapter = createAdapter("github-app");
		const tokenAdapter = createAdapter("github-token");

		expect(appAdapter).toBeInstanceOf(GitHubAdapter);
		expect(tokenAdapter).toBeInstanceOf(GitHubAdapter);
		expect(appAdapter?.name).toBe("github");
		expect(tokenAdapter?.name).toBe("github");

		expect(isAdapterSupported("github-app")).toBe(true);
		expect(isAdapterSupported("github-token")).toBe(true);
	});

	it("resolves render and vercel to their respective adapters", () => {
		const renderAdapter = createAdapter("render");
		const vercelAdapter = createAdapter("vercel");

		expect(renderAdapter).toBeInstanceOf(RenderAdapter);
		expect(vercelAdapter).toBeInstanceOf(VercelAdapter);
		expect(renderAdapter?.name).toBe("render");
		expect(vercelAdapter?.name).toBe("vercel");

		expect(isAdapterSupported("render")).toBe(true);
		expect(isAdapterSupported("vercel")).toBe(true);
	});

	it("resolves unknown templateIds to null cleanly", () => {
		expect(createAdapter("gitlab")).toBeNull();
		expect(createAdapter("bitbucket")).toBeNull();
		expect(createAdapter("prometheus")).toBeNull();
		expect(createAdapter("slack")).toBeNull();
		expect(createAdapter("slack-token")).toBeNull();
		expect(createAdapter("nonsense")).toBeNull();

		expect(isAdapterSupported("gitlab")).toBe(false);
		expect(isAdapterSupported("prometheus")).toBe(false);
		expect(isAdapterSupported("nonsense")).toBe(false);
	});

	it("derives segments and capabilities correctly per adapter", () => {
		const github = new GitHubAdapter();
		const render = new RenderAdapter();
		const vercel = new VercelAdapter();

		// Segment derivation
		expect(github.vcs).toBeDefined();
		expect(github.deployment).toBeUndefined();
		expect(getAdapterSegments(github)).toEqual(["vcs"]);
		expect(adapterSegments(github)).toEqual(["vcs"]);

		expect(render.deployment).toBeDefined();
		expect(render.vcs).toBeUndefined();
		expect(getAdapterSegments(render)).toEqual(["deployment"]);
		expect(adapterSegments(render)).toEqual(["deployment"]);

		expect(vercel.deployment).toBeDefined();
		expect(vercel.vcs).toBeUndefined();
		expect(getAdapterSegments(vercel)).toEqual(["deployment"]);
		expect(adapterSegments(vercel)).toEqual(["deployment"]);

		// Capability derivation
		const githubCaps = getAdapterCapabilities(github);
		expect(githubCaps).toContain("vcs:list_orgs");
		expect(githubCaps).toContain("vcs:list_repos");
		expect(githubCaps).toContain("vcs:read_file");
		expect(githubCaps).toContain("vcs:read_commit_status");
		expect(githubCaps).not.toContain("deployment:list_services");

		const renderCaps = getAdapterCapabilities(render);
		expect(renderCaps).toContain("deployment:list_services");
		expect(renderCaps).toContain("deployment:get_service");
		expect(renderCaps).toContain("deployment:list_deploys");
		expect(renderCaps).not.toContain("vcs:list_repos");

		const vercelCaps = adapterCapabilities(vercel);
		expect(vercelCaps).toContain("deployment:list_services");
		expect(vercelCaps).toContain("deployment:get_service");
		expect(vercelCaps).toContain("deployment:list_deploys");
		expect(vercelCaps).not.toContain("vcs:list_repos");
	});

	it("answers reverse-direction queries for segments and capabilities", () => {
		// templatesForSegment
		expect(getTemplatesForSegment("deployment")).toEqual(["render", "vercel"]);
		expect(templatesForSegment("deployment")).toEqual(["render", "vercel"]);
		expect(getTemplatesForSegment("vcs")).toEqual(["github-app", "github-token"]);
		expect(templatesForSegment("vcs")).toEqual(["github-app", "github-token"]);

		// templatesForCapability
		expect(getTemplatesForCapability("deployment:list_services")).toEqual([
			"render",
			"vercel",
		]);
		expect(templatesForCapability("deployment:list_services")).toEqual([
			"render",
			"vercel",
		]);
		expect(getTemplatesForCapability("vcs:read_file")).toEqual([
			"github-app",
			"github-token",
		]);
		expect(templatesForCapability("vcs:read_file")).toEqual([
			"github-app",
			"github-token",
		]);
		expect(getTemplatesForCapability("monitoring:read")).toEqual([]);
	});
});
