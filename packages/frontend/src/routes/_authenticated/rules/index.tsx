// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { CorrelationRulesTab, MappingRulesTab } from "@/components/rules";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { alertMappingKeys, correlationKeys } from "@/lib/api/hooks";

type RulesTab = "correlation" | "mapping";

type RulesSearch = {
	tab: RulesTab;
};

export const Route = createFileRoute("/_authenticated/rules/")({
	validateSearch: (raw: Record<string, unknown>): RulesSearch => ({
		tab: raw.tab === "mapping" ? "mapping" : "correlation",
	}),
	component: RulesPage,
});

function RulesPage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: "/rules/" });
	const queryClient = useQueryClient();

	const correlationFetching = useIsFetching({
		queryKey: correlationKeys.all(),
	});
	const mappingFetching = useIsFetching({ queryKey: alertMappingKeys.all() });
	const isFetching = correlationFetching + mappingFetching > 0;

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: correlationKeys.all() });
		queryClient.invalidateQueries({ queryKey: alertMappingKeys.all() });
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title="Rules"
				subtitle="Correlation and alert-mapping rules"
				actions={
					<Button
						variant="outline"
						size="sm"
						onClick={handleRefresh}
						disabled={isFetching}
					>
						<RefreshCw
							className={
								isFetching ? "h-4 w-4 mr-1 animate-spin" : "h-4 w-4 mr-1"
							}
						/>
						Refresh
					</Button>
				}
			/>

			<Tabs
				value={tab}
				onValueChange={(value) =>
					navigate({ search: { tab: value as RulesTab } })
				}
			>
				<TabsList>
					<TabsTrigger value="correlation">Correlation</TabsTrigger>
					<TabsTrigger value="mapping">Alert mapping</TabsTrigger>
				</TabsList>

				<TabsContent value="correlation" className="mt-4">
					<CorrelationRulesTab />
				</TabsContent>
				<TabsContent value="mapping" className="mt-4">
					<MappingRulesTab />
				</TabsContent>
			</Tabs>
		</div>
	);
}
