// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplateResponse } from "@prismalens/contracts/schemas";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ConnectionFormDialog,
	filterAvailableTemplates,
} from "./ConnectionFormDialog";

let capturedContentProps: {
	onPointerDownOutside?: (e: unknown) => void;
	onInteractOutside?: (e: unknown) => void;
} = {};

const alertmanager = {
	id: "alertmanager",
	name: "Alertmanager",
	version: "1.0",
	category: "alerts",
	authMode: "basic" as const,
	hasOAuth: false,
	authModeLabel: "Basic",
	connectionCreationMode: "form" as const,
	postCreationAction: "none" as const,
} satisfies AuthTemplateResponse;

const prometheus = {
	id: "prometheus",
	name: "Prometheus",
	version: "1.0",
	category: "metrics",
	authMode: "basic" as const,
	hasOAuth: false,
	authModeLabel: "Basic",
	connectionCreationMode: "form" as const,
	postCreationAction: "none" as const,
} satisfies AuthTemplateResponse;

const github = {
	id: "github",
	name: "GitHub",
	version: "1.0",
	category: "git",
	authMode: "github_app" as const,
	hasOAuth: true,
	authModeLabel: "GitHub App",
	connectionCreationMode: "oauth_redirect" as const,
	postCreationAction: "oauth_redirect" as const,
} satisfies AuthTemplateResponse;

vi.mock("@/lib/api/hooks", () => ({
	useIntegrations: () => ({ data: [] }),
	useTemplates: () => ({ data: [alertmanager, prometheus, github] }),
	useCreateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCreateIntegration: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteIntegration: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children }: { children: React.ReactNode }) => children,
	DialogContent: (props: {
		children: React.ReactNode;
		onPointerDownOutside?: (e: unknown) => void;
		onInteractOutside?: (e: unknown) => void;
	}) => {
		capturedContentProps = props;
		return props.children;
	},
	DialogHeader: ({ children }: { children: React.ReactNode }) => children,
	DialogTitle: ({ children }: { children: React.ReactNode }) => children,
	DialogDescription: ({ children }: { children: React.ReactNode }) => children,
	DialogFooter: ({ children }: { children: React.ReactNode }) => children,
}));

describe("ConnectionFormDialog (f13)", () => {
	beforeEach(() => {
		capturedContentProps = {};
	});

	it("holds Alertmanager and Prometheus given form and oauth_redirect templates on an empty workspace", () => {
		const templates: AuthTemplateResponse[] = [alertmanager, prometheus, github];
		const available = filterAvailableTemplates(templates, []);

		expect(available.map((t) => t.name)).toEqual(["Alertmanager", "Prometheus"]);
	});

	it("leaves outside dismissal to the dialog primitive (#776 review)", () => {
		renderToStaticMarkup(
			React.createElement(ConnectionFormDialog, {
				open: true,
				onOpenChange: vi.fn(),
				mode: "create",
			}),
		);

		// A custom handler closed the form when the provider Select took focus;
		// Radix's own backdrop dismissal is covered in e2e connection-dialog.spec.ts.
		expect(capturedContentProps.onPointerDownOutside).toBeUndefined();
		expect(capturedContentProps.onInteractOutside).toBeUndefined();
	});
});
