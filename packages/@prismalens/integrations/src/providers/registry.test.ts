// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	getCapabilities,
	getTemplatesForCapability,
} from "../engine/index.js";
import { getTemplate } from "../templates/index.js";
import {
	adapterSegments,
	createAdapter,
	getAdapterSegments,
	getTemplatesForSegment,
	GitHubAdapter,
	isAdapterSupported,
	RenderAdapter,
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

	it("derives segments correctly per adapter", () => {
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
		expect(getTemplatesForCapability("vcs:read_file")).toEqual([
			"github-app",
			"github-token",
		]);
		expect(getTemplatesForCapability("vcs:list_orgs")).toEqual([
			"github-token",
		]);
		expect(getTemplatesForCapability("vcs:list_repos")).toEqual([
			"github-app",
			"github-token",
		]);
		expect(getTemplatesForCapability("monitoring:read")).toEqual([]);

		// Template-level capability asymmetry
		const appTemplate = getTemplate("github-app");
		const tokenTemplate = getTemplate("github-token");
		expect(appTemplate).toBeDefined();
		expect(tokenTemplate).toBeDefined();
		expect(getCapabilities(appTemplate!)).not.toContain("vcs:list_orgs");
		expect(getCapabilities(tokenTemplate!)).toContain("vcs:list_orgs");
	});
});
