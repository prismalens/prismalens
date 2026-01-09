import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/services/")({
	component: ServicesPage,
});

function ServicesPage() {
	return (
		<div>
			{/* TODO: Implement ServicesPage */}
			{/* Will use: PageHeader, ServiceList, ServiceCard, EmptyState */}
		</div>
	);
}
