# flows-v3.feature, @pr3, the part design PR 3b builds: the box, the conversation,
# Stop then continue, the model reaching the agent, attachments and two devices.
# Scenario text is flows-v3's; backgrounds name the fake agent's script a scene needs.
@pr3
Feature: The conversation and the box

  Rule: Incident page

    Background:
      Given a paired browser at 1440 px
      And INC-1 is Triggered with no run yet

    Scenario: Starting a run from the box
      When I type "Start with the 14:02 deploy" in the box and press "Start investigation"
      Then the run strip reads "Working" with the agent and model
      And the box reads "Message the agent" with one Stop button

  Rule: Conversation

    Background:
      Given a paired browser at 1440 px and INC-1 has a run in progress

    Scenario: Tool calls read as commands and nothing scrolls sideways
      When I expand "Ran 8 commands"
      Then each row shows the command or path that ran, such as "git show e87ad72" or "read api/routes/books.py"
      And no row shows "bash({" or "read({})"
      And the run's workspace path appears as "repo/"
      And a refused call reads "Not run:" followed by a plain reason
      And neither the page nor the transcript scrolls sideways at 1440, 1024 or 390 px

    Scenario: Agent prose is rendered, only here
      Given the agent wrote "**Alert:** `test block`" and a "### Findings" heading
      Then I see bold "Alert:", inline code "test block" and a heading "Findings"

    Scenario: Enter queues, Send now is explicit, Stop is a word
      When I type "Stop reading tests" and press Enter
      Then my message shows as "You" with "Delivered at the next pause", and the agent answers it after its current step
      When I type "Only the 14:02 deploy" and press "Send now"
      Then the agent's current step ends and my message is answered next
      And the box shows "Stop" as a word while the agent works, and no key names anywhere on screen

    Scenario: Esc stops the agent while the box is focused
      Given the agent is working and the box has focus
      When I press Escape
      Then the run strip reads "Stopped by you" and I am still on the Conversation
      Given the box has no focus
      When I press Escape
      Then I am on the board

    Scenario: The event log is a link
      Then the Conversation header shows no "Transcript / Ledger" control
      When the run ends
      Then the end line offers "Event log"

  Rule: Stop then continue
    Stop ends the run as the agent ends a cancelled turn; continuing is what the agent supports.

    Background:
      Given a paired browser at 1440 px and INC-1 has a run in progress on OpenCode

    Scenario: Stop ends the run
      When I press "Stop" in the box
      Then the run strip reads "Stopped by you" and the conversation ends with "Stopped by you at <time> after <elapsed>" with "Event log", and no "Failed"
      And nothing counts down or waits

    Scenario: Continue a stopped run to a report
      Given INC-1's run was stopped and OpenCode can reopen it
      Then the box reads "Continue the investigation" with a note naming the code it saw
      When I type "Only look at the 14:02 deploy" and press Enter
      Then the strip reads "Working" and the agent's next message answers with what it had already found
      When the run finishes
      Then the Report tab shows a report

    Scenario: A finished run takes follow-ups, the report stays
      Given INC-1's run finished with a report
      When I send "Why the 14:02 deploy?" from the box reading "Ask a follow-up"
      Then the agent answers in the conversation and the report is unchanged

    Scenario: An agent that cannot continue says so
      Given the run was on deepagents and was stopped
      Then the box reads "Brief a new investigation" with "Investigate again" and a note saying deepagents cannot reopen a finished session

  Rule: Agent controls

    Background:
      Given a paired browser at 1440 px
      And INC-1 is Triggered with no run yet

    Scenario: The model reaches the agent
      Given Codex is picked with "GPT-5.6"
      When a run starts
      Then the report's run line names "GPT-5.6" and the event log shows the agent accepting it before the first prompt
      Given the agent will not take the model
      Then the run does not start and the box says which models it offered

    Scenario: Attachments
      When I paste a screenshot into the box while Claude Code is picked
      Then a thumbnail chip appears above the field and goes with my message
      When I pick an agent whose check recorded no image capability
      Then the box says "<Agent> can't take images" and nothing is uploaded
      When I pick an agent not yet checked
      Then the paperclip's tooltip reads "Images: not checked yet" and only text attaches
      When I attach a 20-line log file
      Then the agent cites it as "attachment: <name>" in the report's evidence

  Rule: Two devices

    Scenario: A message from the phone, Stop from the laptop
      Given INC-1's run is working and the laptop and the phone both show its Conversation
      When I send "Check the deploy diff" from the phone
      Then the laptop shows the message as "You" within 2 seconds
      When I press Stop on the laptop
      Then the phone's strip reads "Stopped by you" and its box reads "Continue the investigation"
