# Capabilities: every action and its visible path

A UI change keeps every capability below reachable without a shortcut, at most two interactions from where a user would look for it. A PR that moves or removes one updates this table and says why (`CONTRIBUTING.md`, UI changes). Interactions are clicks or key presses from the surface named, with that page already open.

| Capability | Where | Interactions | Shortcut or palette |
| :- | :- | :-: | :- |
| Start a thread | Sidebar New, then the Home box | 1 | Ctrl Shift O |
| Start it on a project or a service | Home, the subject under the question | 1 | |
| Log an incident by hand | Home Incident, or Operations header Log incident | 1 | `c` |
| Repeat a message as a schedule | Composer Repeat… beside Send (host only) | 1 | |
| Search threads, incidents, services, projects and pages | Sidebar Search | 1 | Ctrl K |
| Add a project | Search, Add project; Home subject menu, Add project | 2 | Ctrl K "Add project" |
| Add a project from GitHub, GitLab or Bitbucket | Add project, the host in its switch | 1 | |
| Projects and their code | Search, Projects | 2 | Ctrl K "Projects" |
| See every thread | Sidebar Threads, or Recents' View all | 1 | `g t` |
| Filter threads by who started them, status or project | Threads page filters | 1 | |
| Rename, stop or settle a thread, and undo a settle | Sidebar row on hover, then its button | 2 | |
| Move through the thread list | Sidebar list | 1 | `j` / `k`, Enter |
| See what waits for approval | Sidebar Waiting for you; phone strip "N waiting" | 1 | Threads, Status: Waiting for you |
| Schedules and alert intake | Sidebar Automation (New schedule there) | 1 | Ctrl K "Automation" |
| Alerts with no service, linked to a project | Sidebar "N alerts unmapped", then the row's Link to a project | 2 | `g a` |
| Settle quiet threads after some days | Settings, General | 2 | |
| Choose the editor files open in | Settings, General, Open files in | 2 | |
| Cold conversations, resume after a limit, and whether agents start threads | Settings, Agent | 2 | |
| Pull request status and images from the git host | Settings, Sources | 2 | |
| Services and their code | Sidebar Services | 1 | Ctrl K "Services" |
| The incident board | Sidebar Operations (once alerts have arrived) | 1 | `g o` |
| Settings | Sidebar foot Settings; phone menu | 1 | Ctrl K "Settings" |
| See and install an update | Sidebar foot Update ready, then About | 1 to 2 | |
| Terminal | Sidebar foot Terminal | 1 | Ctrl \` |
| Theme | Sidebar foot theme button | 1 | Ctrl K action |
| Hide or show the sidebar | Sidebar head button; page header Show | 1 | `[` |
| Open a thread's latest run | The thread's row; `/incidents/$id` opens it | 1 | |
| A thread's status | Thread page header Status | 1 | |
| What a thread is about: incident and suspects, a schedule's runs, a service, a project and its scripts | Thread page header Panel, the kind tab (Incident, Runs, Service or Project) | 1 to 2 | `?panel=kind` |
| A thread's pull requests and checks, the threads its agent started, its plan, steps, machine and agent | Thread page header Panel, Thread tab | 1 to 2 | `?panel=thread` |
| A thread's changed files and diff | Thread page header Panel, Changes tab; the status box's changes | 1 to 2 | `?panel=changes` |
| A page the agent or a link opened (desktop app) | Panel, Browser tab, once a page was opened | 1 | `?panel=browser` |
| Open a path, PR, thread, incident or page the agent named | The link in the agent's message | 1 | Ctrl or Cmd click opens a new tab |
| Message a thread an agent started | Panel, Thread tab, Threads, then that thread's own box | 2 | |
| Apply or dismiss an agent's proposal; revoke "Agents may start threads here" | The proposal card in the transcript; Panel, Thread tab, Threads (host only) | 1 to 2 | |
| Link a service to a blank incident | The incident page, Link service | 1 | |
| Start git in a plain folder | Project page, Start git here (host only) | 1 | |
| An incident's impact, fixes, finding and changes | Run page details toggle, Incident tab; report card link | 2 | |
| A run's summary, runbooks, brief, delivery state, alert labels and flagged content (was Summary and Context) | Run page details toggle, Incident tab | 2 | `?panel=summary` and `?panel=context` still open it |
| A run's steps, filtered, with failed-step navigation (was Steps) | Run page details toggle, Thread tab, Steps | 2 | `?panel=steps` |
| A run's files, diff and kept workspaces (was Files and Changes; kept workspaces were on Summary) | Run page details toggle, Changes tab | 2 | `?panel=files`, `?panel=changes` |
| Stop, retry or resume a run | Run strip | 1 | |
| Ask for a lasting fix | Summary Next; report card | 1 | |
| Add a note | Header More, Add a note | 2 | |
| Resolve, reopen, merge, severity, status update | Header (Resolve), More menu (the rest; Resolve too on a phone) | 1 to 2 | |
| Send a suggested command to the terminal | The command's code block or step | 1 | |
| A step's command, output and file | The folded tool line, then the step | 2 | |
