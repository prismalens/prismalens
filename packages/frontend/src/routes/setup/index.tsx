import {
	createFileRoute,
	isRedirect,
	redirect,
	useSearch,
} from "@tanstack/react-router";
import type { SetupStep } from "@prismalens/contracts";
import { SetupWizard } from "@/components/setup";
import { client } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/setup/")({
	component: SetupPage,
	validateSearch: (search: Record<string, unknown>) => ({
		callback: search.callback === "true",
		provider: search.provider as string | undefined,
		success: search.success as string | undefined,
		redirect: (search.redirect as string) || undefined,
	}),
	beforeLoad: async ({ search }) => {
		// If this is an OAuth callback, don't check setup status
		// (let the wizard handle it)
		if (search.callback) {
			return;
		}

		try {
			const result = await client.setup.getStatus({});
			if (result.currentStep === "complete") {
				// Setup already done, redirect to home or the requested redirect
				throw redirect({
					to: search.redirect || "/",
				});
			}
		} catch (error) {
			// If it's a redirect, rethrow it
			if (isRedirect(error)) {
				throw error;
			}
			// If we can't check status, let the page load anyway
			// (the wizard will show an error if API is unreachable)
		}
	},
	loader: async ({ location }): Promise<{ initialStep: SetupStep }> => {
		// For OAuth callback, default to integration step
		if (location.search && "callback" in location.search && location.search.callback) {
			return { initialStep: "integration" };
		}

		try {
			const result = await client.setup.getStatus({});
			return { initialStep: result.currentStep };
		} catch {
			// If we can't get status, start from the beginning
			return { initialStep: "account" };
		}
	},
});

function SetupPage() {
	const { initialStep } = Route.useLoaderData();
	const searchParams = useSearch({ from: "/setup/" });

	return <SetupWizard searchParams={searchParams} initialStep={initialStep} />;
}
