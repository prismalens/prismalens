"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type React from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface StatCardProps {
	title: string;
	value: string;
	icon: React.ReactNode;
	trend: string;
	trendUp?: boolean;
	loading?: boolean;
}

export function StatCard({
	title,
	value,
	icon,
	trend,
	trendUp,
	loading,
}: StatCardProps) {
	return (
		<Card>
			<CardContent className="pt-5">
				{loading ? (
					<div className="flex items-center">
						<Skeleton className="h-6 w-6 rounded" />
						<div className="ml-5 flex-1">
							<Skeleton className="h-4 w-24 mb-2" />
							<Skeleton className="h-8 w-16" />
						</div>
					</div>
				) : (
					<div className="flex items-center">
						<div className="flex-shrink-0">{icon}</div>
						<div className="ml-5 w-0 flex-1">
							<p className="text-sm font-medium text-muted-foreground truncate">
								{title}
							</p>
							<p className="text-2xl font-semibold text-foreground">{value}</p>
						</div>
					</div>
				)}
			</CardContent>
			<CardFooter className="bg-muted/50 py-3">
				{loading ? (
					<Skeleton className="h-4 w-32" />
				) : (
					<div className="flex items-center gap-1 text-sm text-muted-foreground">
						{trendUp !== undefined &&
							(trendUp ? (
								<TrendingUp className="h-4 w-4 text-red-500" />
							) : (
								<TrendingDown className="h-4 w-4 text-green-500" />
							))}
						{trend}
					</div>
				)}
			</CardFooter>
		</Card>
	);
}
