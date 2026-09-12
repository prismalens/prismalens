// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { SetupWizard } from "@/components/setup";
import { client } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/setup/")({
	component: SetupPage,
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: (search.redirect as string) || undefined,
	}),
	// The wizard is single-step (account only, #337/#609): `setupComplete`
	// already means exactly "an owner account exists", so it alone decides
	// whether /setup still has a job to do — unlike the old multi-step
	// `currentStep === "complete"` check, which waited on steps this route no
	// longer renders.
	beforeLoad: async ({ search }) => {
		try {
			const result = await client.setup.getStatus({});
			if (result.setupComplete) {
				throw redirect({
					to: search.redirect || "/incidents",
				});
			}
		} catch (error) {
			if (isRedirect(error)) {
				throw error;
			}
		}
	},
});

function SetupPage() {
	const search = Route.useSearch();

	return <SetupWizard redirect={search.redirect} />;
}
