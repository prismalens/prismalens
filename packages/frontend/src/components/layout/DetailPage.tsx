import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Tab<T extends string> {
	value: T;
	label: string;
	icon?: LucideIcon;
}

interface DetailPageProps<T extends string> {
	tabs: Tab<T>[];
	activeTab: T;
	onTabChange: (tab: T) => void;
	children: ReactNode;
	header?: ReactNode;
}

export function DetailPage<T extends string>({
	tabs,
	activeTab,
	onTabChange,
	children,
	header,
}: DetailPageProps<T>) {
	return (
		<div className="space-y-6">
			{header}

			<div className="flex gap-8">
				{/* Sidebar Navigation */}
				<nav className="w-48 flex-shrink-0">
					<ul className="space-y-1">
						{tabs.map((t) => (
							<li key={t.value}>
								<button
									type="button"
									onClick={() => onTabChange(t.value)}
									className={cn(
										"w-full text-left text-sm px-3 py-2 rounded-md transition-colors flex items-center gap-2",
										activeTab === t.value
											? "bg-accent text-accent-foreground font-medium"
											: "text-muted-foreground hover:text-foreground hover:bg-muted",
									)}
								>
									{t.icon && <t.icon className="h-4 w-4" />}
									{t.label}
								</button>
							</li>
						))}
					</ul>
				</nav>

				{/* Content */}
				<div className="flex-1 min-w-0">{children}</div>
			</div>
		</div>
	);
}
