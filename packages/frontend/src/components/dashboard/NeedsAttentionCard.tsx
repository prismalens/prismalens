// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface NeedsAttentionCardProps {
	title: string;
	count: number;
	icon: React.ReactNode;
	loading?: boolean;
	emptyText: string;
	viewAllHref: string;
	viewAllText: string;
	children?: React.ReactNode;
}

export function NeedsAttentionCard({
	title,
	count,
	icon,
	loading,
	emptyText,
	viewAllHref,
	viewAllText,
	children,
}: NeedsAttentionCardProps) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<CardTitle className="text-base font-medium flex items-center gap-2">
						{icon}
						{title}
					</CardTitle>
					<Badge variant="outline">{loading ? "-" : count}</Badge>
				</div>
			</CardHeader>
			<CardContent>
				{loading ? (
					<div className="space-y-2">
						{[1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-10 w-full" />
						))}
					</div>
				) : count === 0 ? (
					<div className="py-4">
						<p className="text-sm text-muted-foreground">{emptyText}</p>
					</div>
				) : (
					<>
						<div className="divide-y divide-border">{children}</div>
						<Button variant="ghost" size="sm" className="w-full mt-2" asChild>
							<Link to={viewAllHref}>
								{viewAllText} <ArrowRight className="ml-1 h-4 w-4" />
							</Link>
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	);
}
