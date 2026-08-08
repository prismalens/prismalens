// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { CheckCircle } from "lucide-react";
import { SetupNextStepHint } from "@/components/setup";
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
						// On a configured instance this is genuinely good news, so the
						// generic links stay. On a fresh one it is a dead end, so the hint
						// replaces them with the specific missing step (#332).
						<SetupNextStepHint
							fallback={
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
					}
				/>
			</CardContent>
		</Card>
	);
}
