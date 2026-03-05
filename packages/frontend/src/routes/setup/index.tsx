import {
	createFileRoute,
	isRedirect,
	redirect,
} from "@tanstack/react-router";
import type { SetupStep } from "@prismalens/contracts";
import { SetupWizard } from "@/components/setup";
import { client } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/setup/")({
	component: SetupPage,
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: (search.redirect as string) || undefined,
	}),
	beforeLoad: async ({ search }) => {
		try {
			const result = await client.setup.getStatus({});
			if (result.currentStep === "complete") {
				throw redirect({
					to: search.redirect || "/",
				});
			}
		} catch (error) {
			if (isRedirect(error)) {
				throw error;
			}
		}
	},
	loader: async (): Promise<{ initialStep: SetupStep }> => {
		try {
			const result = await client.setup.getStatus({});
			return { initialStep: result.currentStep };
		} catch {
			return { initialStep: "account" };
		}
	},
});

function SetupPage() {
	const { initialStep } = Route.useLoaderData();
	const search = Route.useSearch();

	return <SetupWizard redirect={search.redirect} initialStep={initialStep} />;
}
