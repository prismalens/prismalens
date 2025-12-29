'use client';

/**
 * Navbar Component
 *
 * Main navigation bar with extension slots for enterprise features.
 */

import Link from 'next/link';
import { ExtensionSlot } from './slots';

export function Navbar() {
  return (
    <nav className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Left side - Logo and extension slot */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-xl font-bold text-primary-600 hover:text-primary-700"
            >
              PrismaLens
            </Link>

            {/* Extension slot for left navbar items (e.g., workspace switcher) */}
            <ExtensionSlot
              view="layout"
              slot="navbar-left"
              className="flex items-center gap-2"
            />
          </div>

          {/* Right side - Navigation and extension slot */}
          <div className="flex items-center space-x-4">
            <Link
              href="/"
              className="text-slate-600 dark:text-slate-300 hover:text-primary-600"
            >
              Dashboard
            </Link>
            <Link
              href="/investigations"
              className="text-slate-600 dark:text-slate-300 hover:text-primary-600"
            >
              Investigations
            </Link>
            <Link
              href="/settings"
              className="text-slate-600 dark:text-slate-300 hover:text-primary-600"
            >
              Settings
            </Link>

            {/* Extension slot for right navbar items (e.g., billing status, user menu) */}
            <ExtensionSlot
              view="layout"
              slot="navbar-right"
              className="flex items-center gap-2 ml-4 pl-4 border-l border-slate-200 dark:border-slate-700"
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
