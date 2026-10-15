// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { call } from "@orpc/server";
import type { BindingDetection, ServiceBinding } from "@prismalens/contracts";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../../core/auth/auth.guard.js";
import type { OperatorResolver } from "../../core/auth/operator.resolver.js";
import { IS_PUBLIC_KEY } from "../../core/auth/public.decorator.js";
import {
	BindingNotFoundError,
	BindingRefusedError,
	BindingsService,
	ServiceNotFoundError,
} from "./bindings.service.js";
import type { CaseFileSettingsService } from "./case-file-settings.service.js";
import { CaseFilesController } from "./case-files.controller.js";
import type { CaseViewService } from "./case-view.service.js";

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";

const mockDetection: BindingDetection = {
	kubectl: { path: "/usr/local/bin/kubectl", version: "v1.31.0" },
	contexts: ["kind-pl", "prod"],
	currentContext: "kind-pl",
	current: {
		cluster: "https://127.0.0.1:6443",
		user: "admin",
		namespace: "shop",
	},
	suggested: { kubeContext: "kind-pl", namespace: "shop" },
};

const mockBinding: ServiceBinding = {
	id: "b1",
	serviceId: SERVICE_ID,
	kind: "kubernetes",
	kubeContext: "kind-pl",
	cluster: "https://127.0.0.1:6443",
	namespace: "shop",
	kubeUser: "admin",
	detected: mockDetection,
	confirmedAt: "2026-10-15T00:00:00.000Z",
	probeState: "ok",
	probeDetail: null,
	probedAt: "2026-10-15T00:00:00.000Z",
	createdAt: "2026-10-15T00:00:00.000Z",
	updatedAt: "2026-10-15T00:00:00.000Z",
};

describe("CaseFilesController - Auth Guard", () => {
	it("controller is not marked with @Public()", () => {
		expect(
			Reflect.getMetadata(IS_PUBLIC_KEY, CaseFilesController),
		).toBeUndefined();
	});

	it("rejects an unauthenticated caller", async () => {
		const operator = {
			resolveWithReason: vi.fn().mockResolvedValue({
				operator: null,
				reason: "missing",
			}),
		} as unknown as OperatorResolver;
		const guard = new AuthGuard(operator, new Reflector());
		const context = {
			getHandler: () => () => {},
			getClass: () => CaseFilesController,
			switchToHttp: () => ({
				getRequest: () => ({ headers: {} } as Request),
			}),
		} as unknown as ExecutionContext;

		await expect(guard.canActivate(context)).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it("rejects a revoked session", async () => {
		const operator = {
			resolveWithReason: vi.fn().mockResolvedValue({
				operator: null,
				reason: "revoked",
			}),
		} as unknown as OperatorResolver;
		const guard = new AuthGuard(operator, new Reflector());
		const context = {
			getHandler: () => () => {},
			getClass: () => CaseFilesController,
			switchToHttp: () => ({
				getRequest: () => ({ headers: {} } as Request),
			}),
		} as unknown as ExecutionContext;

		await expect(guard.canActivate(context)).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it("allows an authenticated operator", async () => {
		const req = { headers: {} } as Request;
		const operator = {
			resolveWithReason: vi.fn().mockResolvedValue({
				operator: { device: { id: "dev-1" } },
				reason: null,
			}),
		} as unknown as OperatorResolver;
		const guard = new AuthGuard(operator, new Reflector());
		const context = {
			getHandler: () => () => {},
			getClass: () => CaseFilesController,
			switchToHttp: () => ({
				getRequest: () => req,
			}),
		} as unknown as ExecutionContext;

		await expect(guard.canActivate(context)).resolves.toBe(true);
		expect(req.operator).toEqual({ device: { id: "dev-1" } });
	});
});

describe("CaseFilesController - Bindings routes", () => {
	const mockBindingsService = {
		detect: vi.fn(),
		get: vi.fn(),
		confirm: vi.fn(),
		probe: vi.fn(),
		remove: vi.fn(),
	};
	let controller: CaseFilesController;
	const contextOptions = { context: { request: {} as Request } };

	beforeEach(() => {
		vi.clearAllMocks();
		controller = new CaseFilesController(
			mockBindingsService as unknown as BindingsService,
			{} as CaseViewService,
			{} as CaseFileSettingsService,
		);
	});

	describe("detect", () => {
		it("delegates to bindingsService.detect and returns detection", async () => {
			mockBindingsService.detect.mockResolvedValue(mockDetection);
			const result = await call(
				controller.bindings().detect,
				{ serviceId: SERVICE_ID },
				contextOptions,
			);
			expect(result).toEqual(mockDetection);
			expect(mockBindingsService.detect).toHaveBeenCalledWith(SERVICE_ID);
		});
	});

	describe("get", () => {
		it("delegates to bindingsService.get and returns the binding", async () => {
			mockBindingsService.get.mockResolvedValue(mockBinding);
			const result = await call(
				controller.bindings().get,
				{ serviceId: SERVICE_ID },
				contextOptions,
			);
			expect(result).toEqual(mockBinding);
			expect(mockBindingsService.get).toHaveBeenCalledWith(SERVICE_ID);
		});

		it("returns null when unbound", async () => {
			mockBindingsService.get.mockResolvedValue(null);
			const result = await call(
				controller.bindings().get,
				{ serviceId: SERVICE_ID },
				contextOptions,
			);
			expect(result).toBeNull();
			expect(mockBindingsService.get).toHaveBeenCalledWith(SERVICE_ID);
		});
	});

	describe("confirm", () => {
		const confirmInput = {
			serviceId: SERVICE_ID,
			kubeContext: "kind-pl",
			namespace: "shop",
		};

		it("delegates to bindingsService.confirm and returns the binding", async () => {
			mockBindingsService.confirm.mockResolvedValue(mockBinding);
			const result = await call(
				controller.bindings().confirm,
				confirmInput,
				contextOptions,
			);
			expect(result).toEqual(mockBinding);
			expect(mockBindingsService.confirm).toHaveBeenCalledWith(confirmInput);
		});

		it("maps ServiceNotFoundError to NOT_FOUND", async () => {
			mockBindingsService.confirm.mockRejectedValue(
				new ServiceNotFoundError(SERVICE_ID),
			);
			await expect(
				call(controller.bindings().confirm, confirmInput, contextOptions),
			).rejects.toMatchObject({
				code: "NOT_FOUND",
				message: `Service ${SERVICE_ID} not found`,
			});
		});

		it("maps BindingRefusedError to BAD_REQUEST with reason", async () => {
			mockBindingsService.confirm.mockRejectedValue(
				new BindingRefusedError(
					"no-kubectl",
					"kubectl is not on PATH on this machine.",
				),
			);
			await expect(
				call(controller.bindings().confirm, confirmInput, contextOptions),
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: "kubectl is not on PATH on this machine.",
				data: { reason: "no-kubectl" },
			});
		});

		it("rethrows unexpected errors", async () => {
			const unexpected = new Error("database failure");
			mockBindingsService.confirm.mockRejectedValue(unexpected);
			await expect(
				call(controller.bindings().confirm, confirmInput, contextOptions),
			).rejects.toThrow("database failure");
		});
	});

	describe("probe", () => {
		it("delegates to bindingsService.probe and returns the binding", async () => {
			mockBindingsService.probe.mockResolvedValue(mockBinding);
			const result = await call(
				controller.bindings().probe,
				{ serviceId: SERVICE_ID },
				contextOptions,
			);
			expect(result).toEqual(mockBinding);
			expect(mockBindingsService.probe).toHaveBeenCalledWith(SERVICE_ID);
		});

		it("maps BindingNotFoundError to NOT_FOUND", async () => {
			mockBindingsService.probe.mockRejectedValue(
				new BindingNotFoundError(SERVICE_ID),
			);
			await expect(
				call(
					controller.bindings().probe,
					{ serviceId: SERVICE_ID },
					contextOptions,
				),
			).rejects.toMatchObject({
				code: "NOT_FOUND",
				message: `Service ${SERVICE_ID} has no binding`,
			});
		});

		it("maps BindingRefusedError to BAD_REQUEST with reason", async () => {
			mockBindingsService.probe.mockRejectedValue(
				new BindingRefusedError("context-missing", "context missing"),
			);
			await expect(
				call(
					controller.bindings().probe,
					{ serviceId: SERVICE_ID },
					contextOptions,
				),
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: "context missing",
				data: { reason: "context-missing" },
			});
		});

		it("rethrows unexpected errors", async () => {
			const unexpected = new Error("probe execution error");
			mockBindingsService.probe.mockRejectedValue(unexpected);
			await expect(
				call(
					controller.bindings().probe,
					{ serviceId: SERVICE_ID },
					contextOptions,
				),
			).rejects.toThrow("probe execution error");
		});
	});

	describe("remove", () => {
		it("returns { success: true } when bound", async () => {
			mockBindingsService.remove.mockResolvedValue(true);
			const result = await call(
				controller.bindings().remove,
				{ serviceId: SERVICE_ID },
				contextOptions,
			);
			expect(result).toEqual({ success: true });
			expect(mockBindingsService.remove).toHaveBeenCalledWith(SERVICE_ID);
		});

		it("returns { success: false } when unbound", async () => {
			mockBindingsService.remove.mockResolvedValue(false);
			const result = await call(
				controller.bindings().remove,
				{ serviceId: SERVICE_ID },
				contextOptions,
			);
			expect(result).toEqual({ success: false });
			expect(mockBindingsService.remove).toHaveBeenCalledWith(SERVICE_ID);
		});
	});
});
