# Capabilities: every action and its visible path

A UI change keeps every capability below reachable without a shortcut, at most two interactions from where a user would look for it. A PR that moves or removes one updates this table and says why (`CONTRIBUTING.md`, UI changes). Interactions are clicks or key presses from the surface named. Shortcuts belong to the registry, not this table: `pnpm registry ls action` lists every action with its keys,.

| Capability | Where | Interactions |
| :- | :- | :-: |
| Start a thread | Sidebar New, then the Home box | 1 |
| Start it on a project or service | Home, the subject under the question | 1 |
| Log an incident by hand | Home Incident, or Operations header Log incident | 1 |
| Repeat a message as a schedule | Composer Repeat… beside Send (host only) | 1 |
| Search threads, services, projects and pages | Sidebar Search | 1 |
| Add a project | Search, Add project; Home subject menu, Add project | 2 |
| Add a project from a git host | Add project, the host switch | 1 |
| Projects and their code | Sidebar Projects | 1 |
| Services and their code | Sidebar Projects, then Services | 2 |
| See every thread | Sidebar Threads group; on the rail, the Threads sheet | 1 |
| Filter threads by who started them, status or project | Filter on the Threads heading | 1 |
| Rename, stop or settle a thread, and undo a settle | Sidebar row on hover, then its button | 2 |
| See what waits for approval | Sidebar Needs you; phone strip "N waiting" | 1 |
| Schedules and alert intake | Sidebar Triggers (New schedule there) | 1 |
| Alerts with no service, linked to a project | Sidebar Alerts door with its count, then the row's Link to a project | 2 |
| The incident board | Sidebar Operations (once alerts have arrived) | 1 |
| Settle quiet threads after some days; the editor files open in | Settings, General | 2 |
| Cold conversations and resume after a limit | Settings, Agents | 2 |
| Whether agents start threads | Settings, Agent-started threads | 2 |
| Pull request status and images from the git host | Settings, Sources | 2 |
| Settings | Sidebar foot Settings; phone menu | 1 |
| See and install an update | Sidebar foot Update ready, then About | 1 to 2 |
| Terminal, theme | Sidebar foot buttons | 1 |
| Hide or show the sidebar | Sidebar head button; page header Show | 1 |
| Open a thread's latest run | The thread's row; `/incidents/$id` opens it | 1 |
| A thread's status | Thread page header Status | 1 |
| What a thread is about: incident and suspects, a schedule's runs, a service, a project and its scripts | Thread page header Panel, the kind tab (Incident, Runs, Service or Project); `?panel=kind` | 1 to 2 |
| A thread's pull requests and checks, the threads its agent started, its plan, steps, machine and agent | Panel, Thread tab; `?panel=thread` | 1 to 2 |
| A thread's changed files and diff | Panel, Changes tab, or the status box's changes; `?panel=changes` | 1 to 2 |
| A page the agent opened (desktop app) | Panel, Browser tab, once a page was opened; `?panel=browser` | 1 |
| Open a path, PR, thread, incident or page the agent named | The link in the agent's message | 1 |
| Message a thread an agent started | Panel, Thread tab, Threads, then that thread's own box | 2 |
| Apply or dismiss an agent's proposal; revoke "Agents may start threads here" | The proposal card in the transcript; Panel, Thread tab, Threads (host only) | 1 to 2 |
| Link a service to a blank incident | The incident page, Link service | 1 |
| Start git in a plain folder | Project page, Start git here (host only) | 1 |
| An incident's impact, fixes, finding and changes | Run page details toggle, Incident tab; report card link | 2 |
| A run's summary, runbooks, brief, delivery state, alert labels and flagged content | Run page details toggle, Incident tab | 2 |
| A run's steps, filtered, with failed-step navigation | Run page details toggle, Thread tab, Steps; `?panel=steps` | 2 |
| A run's files, diff and kept workspaces | Run page details toggle, Changes tab; `?panel=changes` | 2 |
| Stop, retry or resume a run | Run strip | 1 |
| Ask for a lasting fix | Summary Next; report card | 1 |
| Add a note | Header More | 2 |
| Resolve, reopen, merge, severity, status update | Header (Resolve), More menu (the rest; Resolve too on a phone) | 1 to 2 |
| A step's command, output and file | The folded tool line, then the step | 2 |
| Send a suggested command to the terminal | Its code block or step | 1 |
