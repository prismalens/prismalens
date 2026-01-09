/**
 * Navbar Component
 *
 * Main navigation bar
 */

import { Link } from '@tanstack/react-router'

export function Navbar() {
  return (
    <nav className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Left side - Logo */}
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-xl font-bold text-primary-600 hover:text-primary-700"
            >
              PrismaLens
            </Link>

          </div>

          {/* Right side - Navigation */}
          <div className="flex items-center space-x-4">
            <Link
              to="/"
              className="text-slate-600 dark:text-slate-300 hover:text-primary-600"
            >
              Dashboard
            </Link>
            <Link
              to="/investigations"
              className="text-slate-600 dark:text-slate-300 hover:text-primary-600"
            >
              Investigations
            </Link>
            <Link
              to="/settings"
              className="text-slate-600 dark:text-slate-300 hover:text-primary-600"
            >
              Settings
            </Link>

          </div>
        </div>
      </div>
    </nav>
  )
}
