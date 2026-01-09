import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/services/$id/")({
	component: ServiceDetailPage,
});

function ServiceDetailPage() {
	const { id } = Route.useParams();

	return (
		<div>
			{/* TODO: Implement ServiceDetailPage */}
			{/* Will use: PageHeader, Breadcrumb, ServiceConfigTabs,
          ServiceGeneralForm, ServiceIntegrationsTab,
          ServiceInvestigationTab, ServiceDependenciesTab */}
			<p>Service ID: {id}</p>
		</div>
	);
}
