/**
 * Language Switcher Component
 *
 * A dropdown button for switching between available languages.
 */

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Locale } from "@/lib/paraglide/runtime.js";
import { useLanguage } from "@/lib/providers/language-provider";

const localeNames: Record<Locale, string> = {
	en: "English",
	es: "Espanol",
};

export function LanguageSwitcher() {
	const { locale, setLocale, availableLocales } = useLanguage();

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="h-9 w-9">
					<Languages className="h-4 w-4" />
					<span className="sr-only">Switch language</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{availableLocales.map((loc) => (
					<DropdownMenuItem
						key={loc}
						onClick={() => setLocale(loc)}
						className={locale === loc ? "bg-accent" : ""}
					>
						{localeNames[loc] || loc}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
