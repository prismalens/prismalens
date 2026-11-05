# Capabilities: every action and its visible path

A UI change keeps every capability below reachable without a shortcut, at most two interactions from where a user would look for it. A PR that moves or removes one updates this table and says why (`CONTRIBUTING.md`, UI changes). Interactions are clicks or key presses from the surface named, with that page already open.

| Capability | Where | Interactions | Shortcut or palette |
| :- | :- | :-: | :- |
| Start a thread | Sidebar New, then the Home box | 1 | |
| Search threads, services and pages | Sidebar Search | 1 | Ctrl K |
| See every thread | Sidebar Threads, or Recents' View all | 1 | `t` |
| See what waits for approval | Sidebar Waiting for you; phone strip "N waiting" | 1 | Threads, Status: Waiting for you |
| Schedules and alert intake | Sidebar Automation | 1 | Ctrl K "Automation" |
| Services and their code | Sidebar Services | 1 | Ctrl K "Services" |
| The incident board | Sidebar Operations (once alerts have arrived) | 1 | `o` |
| Settings | Sidebar foot Settings; phone menu | 1 | Ctrl K "Settings" |
| Terminal | Sidebar foot Terminal | 1 | Ctrl \` |
| Theme | Sidebar foot theme button | 1 | Ctrl K action |
| Hide or show the sidebar | Sidebar head button; page header Show | 1 | `[` |
| Open a thread's latest run | The thread's row; `/incidents/$id` opens it | 1 | |
| An incident's impact, fixes, finding and changes | Run page details toggle, Incident tab; report card link | 2 | |
| Stop, retry or resume a run | Run strip | 1 | |
| Ask for a lasting fix | Summary Next; report card | 1 | |
| Add a note | Header More, Add a note | 2 | |
| Resolve, reopen, merge, severity, status update | Header (Resolve), More menu (the rest; Resolve too on a phone) | 1 to 2 | |
| Send a suggested command to the terminal | The command's code block or step | 1 | |
| A step's command, output and file | The folded tool line, then the step | 2 | |
