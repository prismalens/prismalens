/**
 * Navbar Component
 *
 * Main navigation bar with theme toggle and language switcher using shadcn NavigationMenu
 */

import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
	NavigationMenu,
	NavigationMenuList,
	NavigationMenuItem,
	NavigationMenuLink,
	navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import * as m from "@/lib/paraglide/messages.js";

export function Navbar() {
	return (
		<nav className="relative z-40 bg-card border-b border-border">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex justify-between h-16">
					{/* Left side - Logo */}
					<div className="flex items-center gap-4">
						<Link
							to="/"
							className="text-xl font-bold text-primary hover:text-primary/80 transition-colors"
						>
							{m.app_name()}
						</Link>
					</div>

					{/* Right side - Navigation */}
					<div className="flex items-center gap-2">
						<NavigationMenu>
							<NavigationMenuList>
								<NavigationMenuItem>
									<NavigationMenuLink
										asChild
										className={navigationMenuTriggerStyle()}
									>
										<Link to="/">{m.nav_dashboard()}</Link>
									</NavigationMenuLink>
								</NavigationMenuItem>
								<NavigationMenuItem>
									<NavigationMenuLink
										asChild
										className={navigationMenuTriggerStyle()}
									>
										<Link to="/investigations">{m.nav_investigations()}</Link>
									</NavigationMenuLink>
								</NavigationMenuItem>
								<NavigationMenuItem>
									<NavigationMenuLink
										asChild
										className={navigationMenuTriggerStyle()}
									>
										<Link to="/settings">{m.nav_settings()}</Link>
									</NavigationMenuLink>
								</NavigationMenuItem>
							</NavigationMenuList>
						</NavigationMenu>
						<LanguageSwitcher />
						<ThemeToggle />
					</div>
				</div>
			</div>
		</nav>
	);
}
