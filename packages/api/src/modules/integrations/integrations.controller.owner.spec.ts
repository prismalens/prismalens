// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ModuleRef } from "@nestjs/core";
import { ACCESS_SCOPE } from "@prismalens/auth";
import { describe, expect, it, vi } from "vitest";
import type { GitCredentialService } from "./git-credential.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import type { IntegrationsService } from "./integrations.service.js";
import type { SourcesService } from "./sources.service.js";

type Callable = {
	"~orpc": { handler: (o: { input: unknown; context: { request: unknown } }) => unknown };
};

const pairedRequest = {
	operator: {
		device: {
			id: "dev-paired",
			scopes: ["investigate:read", "investigate:operate"],
		},
	},
};

const ownerRequest = {
	operator: {
		device: {
			id: "dev-owner",
			scopes: ["investigate:read", "investigate:operate", ACCESS_SCOPE],
		},
	},
};

const mockConnection = {
	id: "conn-1",
	integrationId: "int-1",
	label: "conn-1",
	status: "ACTIVE",
	tokenExpiresAt: null,
	grantedScopes: null,
	lastUsedAt: null,
	lastRefreshedAt: null,
	lastErrorMessage: null,
	lastErrorAt: null,
	consecutiveErrors: 0,
	createdAt: new Date("2026-10-01T00:00:00Z"),
	updatedAt: new Date("2026-10-01T00:00:00Z"),
};

function setup() {
	const integrationsService = {
		createConnection: vi.fn(async () => mockConnection),
		updateConnection: vi.fn(async () => mockConnection),
		deleteConnection: vi.fn(async () => true),
		updateConnectionConfig: vi.fn(async () => mockConnection),
		createIntegration: vi.fn(),
		updateIntegration: vi.fn(),
		deleteIntegration: vi.fn(),
	};
	const gitCredentials = {
		invalidate: vi.fn(),
	};
	const moduleRef = {
		get: vi.fn(() => ({ onWebhook: vi.fn() })),
	};
	const sources = {
		connect: vi.fn(async () => ({ connectionId: "conn-1" })),
	};

	const controller = new IntegrationsController(
		integrationsService as unknown as IntegrationsService,
		gitCredentials as unknown as GitCredentialService,
		moduleRef as unknown as ModuleRef,
		undefined,
		sources as unknown as SourcesService,
	);

	return { controller, integrationsService, gitCredentials, sources };
}

describe("IntegrationsController owner guard (#1066)", () => {
	it("sources.connect: refuses a paired device and connects for the owner", async () => {
		const { controller, sources, gitCredentials } = setup();
		const route = controller.sourcesConnect() as unknown as Callable;
		const input = { sourceKind: "github", label: "my-gh", token: "ghp_123" };

		await expect(async () =>
			route["~orpc"].handler({ input, context: { request: pairedRequest } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change source credentials.",
		});
		expect(sources.connect).not.toHaveBeenCalled();

		await route["~orpc"].handler({ input, context: { request: ownerRequest } });
		expect(sources.connect).toHaveBeenCalledWith(input);
		expect(gitCredentials.invalidate).toHaveBeenCalled();
	});

	it("createConnection: refuses a paired device and creates for the owner", async () => {
		const { controller, integrationsService, gitCredentials } = setup();
		const procs = controller.integrations() as Record<string, unknown>;
		const route = procs.createConnection as Callable;
		const input = { integrationId: "int-1", label: "conn-1" };

		await expect(async () =>
			route["~orpc"].handler({ input, context: { request: pairedRequest } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change source credentials.",
		});
		expect(integrationsService.createConnection).not.toHaveBeenCalled();

		await route["~orpc"].handler({ input, context: { request: ownerRequest } });
		expect(integrationsService.createConnection).toHaveBeenCalledWith(input);
		expect(gitCredentials.invalidate).toHaveBeenCalled();
	});

	it("updateConnection: refuses a paired device and updates for the owner", async () => {
		const { controller, integrationsService, gitCredentials } = setup();
		const procs = controller.integrations() as Record<string, unknown>;
		const route = procs.updateConnection as Callable;
		const input = { id: "conn-1", label: "new-label" };

		await expect(async () =>
			route["~orpc"].handler({ input, context: { request: pairedRequest } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change source credentials.",
		});
		expect(integrationsService.updateConnection).not.toHaveBeenCalled();

		await route["~orpc"].handler({ input, context: { request: ownerRequest } });
		expect(integrationsService.updateConnection).toHaveBeenCalledWith("conn-1", {
			label: "new-label",
		});
		expect(gitCredentials.invalidate).toHaveBeenCalled();
	});

	it("deleteConnection: refuses a paired device and deletes for the owner", async () => {
		const { controller, integrationsService, gitCredentials } = setup();
		const procs = controller.integrations() as Record<string, unknown>;
		const route = procs.deleteConnection as Callable;
		const input = { id: "conn-1" };

		await expect(async () =>
			route["~orpc"].handler({ input, context: { request: pairedRequest } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change source credentials.",
		});
		expect(integrationsService.deleteConnection).not.toHaveBeenCalled();

		await route["~orpc"].handler({ input, context: { request: ownerRequest } });
		expect(integrationsService.deleteConnection).toHaveBeenCalledWith("conn-1");
		expect(gitCredentials.invalidate).toHaveBeenCalled();
	});

	it("updateConnectionConfig: refuses a paired device and updates config for the owner", async () => {
		const { controller, integrationsService } = setup();
		const procs = controller.integrations() as Record<string, unknown>;
		const route = procs.updateConnectionConfig as Callable;
		const input = { id: "conn-1", config: { apiKey: "secret" } };

		await expect(async () =>
			route["~orpc"].handler({ input, context: { request: pairedRequest } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change source credentials.",
		});
		expect(integrationsService.updateConnectionConfig).not.toHaveBeenCalled();

		await route["~orpc"].handler({ input, context: { request: ownerRequest } });
		expect(integrationsService.updateConnectionConfig).toHaveBeenCalledWith(
			"conn-1",
			{ apiKey: "secret" },
		);
	});

	it.each([
		["createIntegration", { type: "oauth2", clientId: "c", clientSecret: "s" }],
		["updateIntegration", { id: "int-1", clientSecret: "s2" }],
		["deleteIntegration", { id: "int-1" }],
	] as const)(
		"%s: refuses a paired device before the service is called",
		async (name, input) => {
			const { controller, integrationsService } = setup();
			const procs = controller.integrations() as Record<string, unknown>;
			const route = procs[name] as Callable;

			await expect(async () =>
				route["~orpc"].handler({ input, context: { request: pairedRequest } }),
			).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Only the owner can change source credentials.",
			});
			expect(integrationsService[name]).not.toHaveBeenCalled();
		},
	);
});
