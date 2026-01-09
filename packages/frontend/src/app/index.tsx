import { createFileRoute } from '@tanstack/react-router'
import { AlertCircle, Activity, CheckCircle, Clock } from 'lucide-react'
import { ApiStatusCheck } from '@/components/ApiStatusCheck'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          Dashboard
        </h1>
        <ApiStatusCheck />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          title="Active Alerts"
          value="3"
          icon={<AlertCircle className="h-6 w-6 text-red-500" />}
          trend="+2 from yesterday"
        />
        <StatCard
          title="Investigations"
          value="12"
          icon={<Activity className="h-6 w-6 text-blue-500" />}
          trend="5 in progress"
        />
        <StatCard
          title="Resolved Today"
          value="8"
          icon={<CheckCircle className="h-6 w-6 text-green-500" />}
          trend="92% success rate"
        />
        <StatCard
          title="Avg Resolution Time"
          value="4.2m"
          icon={<Clock className="h-6 w-6 text-amber-500" />}
          trend="-30% from last week"
        />
      </div>

      {/* Recent Alerts */}
      <div className="bg-white dark:bg-slate-800 shadow rounded-lg">
        <div className="px-4 py-5 sm:px-6 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg leading-6 font-medium text-slate-900 dark:text-white">
            Recent Alerts
          </h3>
        </div>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          <AlertItem
            title="High Memory Usage"
            service="todo-app-api"
            severity="warning"
            time="5 minutes ago"
          />
          <AlertItem
            title="HTTP 500 Errors Spike"
            service="auth-service"
            severity="critical"
            time="12 minutes ago"
          />
          <AlertItem
            title="Slow Response Times"
            service="payment-gateway"
            severity="warning"
            time="1 hour ago"
          />
        </ul>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  trend,
}: {
  title: string
  value: string
  icon: React.ReactNode
  trend: string
}) {
  return (
    <div className="bg-white dark:bg-slate-800 overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">{icon}</div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">
                {title}
              </dt>
              <dd className="flex items-baseline">
                <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                  {value}
                </div>
              </dd>
            </dl>
          </div>
        </div>
      </div>
      <div className="bg-slate-50 dark:bg-slate-700 px-5 py-3">
        <div className="text-sm text-slate-500 dark:text-slate-400">{trend}</div>
      </div>
    </div>
  )
}

function AlertItem({
  title,
  service,
  severity,
  time,
}: {
  title: string
  service: string
  severity: 'critical' | 'warning' | 'info'
  time: string
}) {
  const severityColors = {
    critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  }

  return (
    <li className="px-4 py-4 sm:px-6 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {title}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{service}</p>
        </div>
        <div className="flex items-center space-x-4">
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${severityColors[severity]}`}
          >
            {severity}
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">{time}</span>
        </div>
      </div>
    </li>
  )
}
