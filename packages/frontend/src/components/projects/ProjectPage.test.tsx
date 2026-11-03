// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	afterRepositoryLink,
	repositoryKeys,
} from "@/lib/api/hooks/use-repositories-orpc";
import { serviceKeys } from "@/lib/api/hooks/use-services-orpc";
import { MakeService } from "./ProjectPage";

const create = vi.fn();
const link = vi.fn();

vi.mock("@/lib/api/hooks/use-services-orpc", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/api/hooks/use-services-orpc")
	>()),
	useCreateService: () => ({ mutateAsync: create, isPending: false }),
	useService: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/hooks/use-repositories-orpc", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/api/hooks/use-repositories-orpc")
	>()),
	useLinkRepository: () => ({ mutateAsync: link, isPending: false }),
}));

const REPO = "00000000-0000-4000-8000-000000000001";
const SERVICE = "00000000-0000-4000-8000-000000000002";

describe("MakeService (#1020)", () => {
	let host: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		create.mockReset();
		link.mockReset();
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	const submit = async () => {
		const button = host.querySelector<HTMLButtonElement>(
			'[data-testid="make-service-submit"]',
		);
		await act(async () => {
			button?.click();
		});
	};

	it("retries only the link after a failed link, never a second service", async () => {
		create.mockResolvedValue({ id: SERVICE });
		link.mockRejectedValueOnce(new Error("link failed")).mockResolvedValue({});
		act(() =>
			root.render(
				<MakeService repositoryId={REPO} defaultName="shop" linked={[]} />,
			),
		);
		await submit();
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(
			"link failed",
		);
		await submit();
		expect(create).toHaveBeenCalledTimes(1);
		expect(link).toHaveBeenCalledTimes(2);
		expect(link).toHaveBeenLastCalledWith({ id: REPO, serviceId: SERVICE });
	});
});

describe("afterRepositoryLink (#1020)", () => {
	it("marks the project's own detail stale, so its page shows the new service", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(repositoryKeys.detail(REPO), { id: REPO });
		queryClient.setQueryData(serviceKeys.detail(SERVICE), { id: SERVICE });
		await afterRepositoryLink(queryClient, { id: REPO, serviceId: SERVICE });
		for (const key of [
			repositoryKeys.detail(REPO),
			serviceKeys.detail(SERVICE),
		])
			expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
	});
});
