"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface IntegrationCardProps {
	name: string;
	description: string;
	connected: boolean;
	onConnect?: () => void;
}

export function IntegrationCard({
	name,
	description,
	connected,
	onConnect,
}: IntegrationCardProps) {
	return (
		<div className="flex justify-between items-center p-4 border border-border rounded-lg">
			<div>
				<h3 className="font-medium text-foreground">{name}</h3>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{connected ? (
				<Badge
					variant="secondary"
					className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
				>
					Connected
				</Badge>
			) : (
				<Button variant="outline" onClick={onConnect}>
					Connect
				</Button>
			)}
		</div>
	);
}
