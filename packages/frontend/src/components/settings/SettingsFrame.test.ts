// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	listedIntegrations,
	type SettingsSectionItem,
	useSettingsSections,
} from "./SettingsFrame";

const h = vi.hoisted(() => ({
	caseFile: undefined as { enabled: boolean } | undefined,
	caseFileFailed: false,
}));

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileSettings: () => ({
		data: h.caseFile,
		isError: h.caseFileFailed,
	}),
}));

vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => ({ effective: null, model: null }),
	agentModelLabel: () => ({ agent: "", model: "" }),
}));

vi.mock("@/lib/api/hooks", () => ({
	useIntegrations: () => ({ data: [] }),
	useConnections: () => ({ data: [] }),
}));

vi.mock("@/lib/api/hooks/use-webhooks-orpc", () => ({
	useLastDelivery: () => ({ data: null }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: null }),
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		settings: {
			delivery: {
				get: {
					queryOptions: () => ({}),
				},
			},
		},
	},
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: false }),
}));

vi.mock("@/components/settings/DevicesTab", () => ({
	useDevices: () => ({ data: null }),
}));

vi.mock("@/components/settings/AboutSettings", () => ({
	useAbout: () => ({ data: null }),
}));

vi.mock("@/components/settings/TelemetrySettings", () => ({
	useTelemetrySettings: () => ({ query: { data: null } }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const holder = { id: "i1", templateId: "git-host-token", label: "Git host token" };
const prom = { id: "i2", templateId: "prometheus", label: "lab" };
const slackish = { id: "i3", templateId: "other", label: "Other" };

describe("listedIntegrations (w8-5)", () => {
	it("drops the token holder once its last token is removed", () => {
		expect(listedIntegrations([holder, prom, slackish], [])).toEqual([
			slackish,
		]);
	});

	it("lists the token holder while it holds a token", () => {
		expect(listedIntegrations([holder], [{ integrationId: "i1" }])).toEqual([
			holder,
		]);
	});
});

describe("useSettingsSections experiments line", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		h.caseFile = undefined;
		h.caseFileFailed = false;
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	let currentSections: SettingsSectionItem[] = [];
	function TestComponent() {
		currentSections = useSettingsSections();
		return null;
	}

	it("shows 'Case File on' when enabled", async () => {
		h.caseFile = { enabled: true };
		await act(async () => root.render(createElement(TestComponent)));
		const exp = currentSections.find((s) => s.tab === "experiments");
		expect(exp?.line).toBe("Case File on");
	});

	it("shows 'None on' when disabled", async () => {
		h.caseFile = { enabled: false };
		await act(async () => root.render(createElement(TestComponent)));
		const exp = currentSections.find((s) => s.tab === "experiments");
		expect(exp?.line).toBe("None on");
	});

	it("shows 'None on' when reading setting failed", async () => {
		h.caseFile = undefined;
		h.caseFileFailed = true;
		await act(async () => root.render(createElement(TestComponent)));
		const exp = currentSections.find((s) => s.tab === "experiments");
		expect(exp?.line).toBe("None on");
	});

	it("shows '' while loading", async () => {
		h.caseFile = undefined;
		h.caseFileFailed = false;
		await act(async () => root.render(createElement(TestComponent)));
		const exp = currentSections.find((s) => s.tab === "experiments");
		expect(exp?.line).toBe("");
	});
});
