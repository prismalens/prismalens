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
	findDeploymentAdapterForHost,
	getAdapterSegments,
	getTemplatesForSegment,
	GitHubAdapter,
	isAdapterSupported,
	RenderAdapter,
	registerAdapter,
	templatesForSegment,
} from "./index.js";
import type { ProviderAdapter } from "./types.js";

describe("Exact-templateId Adapter Registry (#446)", () => {
	it("resolves github-token to GitHubAdapter and the removed GitHub App to nothing", () => {
		const tokenAdapter = createAdapter("github-token");

		expect(tokenAdapter).toBeInstanceOf(GitHubAdapter);
		expect(tokenAdapter?.name).toBe("github");

		expect(isAdapterSupported("github-token")).toBe(true);
		expect(createAdapter("github-app")).toBeNull();
		expect(createAdapter("git-host-token")).toBeNull();
	});

	it("resolves render to its adapter", () => {
		const renderAdapter = createAdapter("render");

		expect(renderAdapter).toBeInstanceOf(RenderAdapter);
		expect(renderAdapter?.name).toBe("render");

		expect(isAdapterSupported("render")).toBe(true);
	});

	it("resolves unknown templateIds to null cleanly", () => {
		expect(createAdapter("gitlab")).toBeNull();
		expect(createAdapter("bitbucket")).toBeNull();
		expect(createAdapter("datadog")).toBeNull();
		expect(createAdapter("slack")).toBeNull();
		expect(createAdapter("slack-token")).toBeNull();
		expect(createAdapter("vercel")).toBeNull();
		expect(createAdapter("nonsense")).toBeNull();

		expect(isAdapterSupported("gitlab")).toBe(false);
		expect(isAdapterSupported("datadog")).toBe(false);
		expect(isAdapterSupported("vercel")).toBe(false);
		expect(isAdapterSupported("nonsense")).toBe(false);
	});

	it("derives segments correctly per adapter", () => {
		const github = new GitHubAdapter();
		const render = new RenderAdapter();

		// Segment derivation
		expect(github.vcs).toBeDefined();
		expect(github.deployment?.listDeploymentEvents).toBeDefined();
		expect(getAdapterSegments(github)).toEqual(["vcs", "deployment"]);
		expect(adapterSegments(github)).toEqual(["vcs", "deployment"]);

		expect(render.deployment).toBeDefined();
		expect(render.vcs).toBeUndefined();
		expect(getAdapterSegments(render)).toEqual(["deployment"]);
		expect(adapterSegments(render)).toEqual(["deployment"]);
	});

	it("answers reverse-direction queries for segments and capabilities", () => {
		// templatesForSegment
		expect(getTemplatesForSegment("deployment")).toEqual([
			"github-token",
			"render",
		]);
		expect(templatesForSegment("deployment")).toEqual([
			"github-token",
			"render",
		]);
		expect(getTemplatesForSegment("vcs")).toEqual(["github-token"]);
		expect(templatesForSegment("vcs")).toEqual(["github-token"]);
		expect(getTemplatesForSegment("metrics")).toEqual(["prometheus"]);
		expect(templatesForSegment("metrics")).toEqual(["prometheus"]);

		// templatesForCapability
		expect(getTemplatesForCapability("deployment:list_services")).toEqual([
			"render",
		]);
		expect(getTemplatesForCapability("vcs:read_file")).toEqual([
			"github-token",
		]);
		expect(getTemplatesForCapability("vcs:list_orgs")).toEqual([
			"github-token",
		]);
		expect(getTemplatesForCapability("vcs:list_repos")).toEqual([
			"github-token",
		]);
		expect(getTemplatesForCapability("monitoring:read")).toEqual([
			"prometheus",
		]);

		// Template-level capability asymmetry
		const tokenTemplate = getTemplate("github-token");
		expect(tokenTemplate).toBeDefined();
		expect(getCapabilities(tokenTemplate!)).toContain("vcs:list_orgs");

		const renderTemplate = getTemplate("render");
		expect(renderTemplate).toBeDefined();
		expect(getCapabilities(renderTemplate!)).toContain(
			"deployment:list_services",
		);
		expect(getCapabilities(renderTemplate!)).toContain("deployment:get_service");
		expect(getCapabilities(renderTemplate!)).toContain("deployment:list_deploys");
		expect(getCapabilities(renderTemplate!)).not.toContain("vcs:list_repos");
	});

	it("registers and unregisters a connector by templateId, and refuses a taken id (#855)", () => {
		class FakeAdapter implements ProviderAdapter {
			readonly name = "fake-ci";
		}
		const unregister = registerAdapter("fake-ci", FakeAdapter);
		expect(createAdapter("fake-ci")).toBeInstanceOf(FakeAdapter);
		expect(isAdapterSupported("fake-ci")).toBe(true);
		expect(() => registerAdapter("fake-ci", FakeAdapter)).toThrow(
			/already registered/,
		);
		expect(() => registerAdapter("github-token", FakeAdapter)).toThrow(
			/already registered/,
		);
		expect(createAdapter("github-token")).toBeInstanceOf(GitHubAdapter);
		unregister();
		expect(createAdapter("fake-ci")).toBeNull();
	});

	it("finds the adapter whose deployment serves a host (#855)", () => {
		class HostCi implements ProviderAdapter {
			readonly name = "host-ci";
			readonly deployment = {
				name: "host-ci",
				servesHost: (host: string) => host === "ci.example.test",
			};
		}
		const unregister = registerAdapter("host-ci", HostCi);
		expect(findDeploymentAdapterForHost("github.com")).toBeInstanceOf(
			GitHubAdapter,
		);
		expect(findDeploymentAdapterForHost("ci.example.test")).toBeInstanceOf(
			HostCi,
		);
		expect(findDeploymentAdapterForHost("ghe.example.test")).toBeNull();
		unregister();
	});
});
