import { Link } from "@tanstack/react-router";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState as SharedEmptyState } from "@/components/ui/empty-state";

export function DashboardEmptyState() {
	return (
		<Card>
			<CardContent className="py-10">
				<SharedEmptyState
					icon={CheckCircle}
					title="No active incidents"
					actions={
						<div className="flex flex-wrap justify-center gap-3">
							<Button variant="outline" size="sm" asChild>
								<Link to="/settings" search={{ tab: "integrations" }}>
									Configure Integrations
								</Link>
							</Button>
							<Button variant="outline" size="sm" asChild>
								<Link to="/services">Add Services</Link>
							</Button>
							<Button variant="outline" size="sm" asChild>
								<Link to="/incidents">View Historical Incidents</Link>
							</Button>
						</div>
					}
				/>
			</CardContent>
		</Card>
	);
}
