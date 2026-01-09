import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/setup/")({
	component: SetupPage,
});

function SetupPage() {
	return (
		<div>
			{/* TODO: Implement SetupPage */}
			{/* Will use: SetupWizard, SetupProgress, SetupStepOwner,
          SetupStepLLM, SetupStepIntegrations */}
		</div>
	);
}
