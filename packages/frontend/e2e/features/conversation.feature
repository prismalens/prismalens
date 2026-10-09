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
      When I type "Start with the 14:02 deploy" in the draft's box and press "Investigate"
      Then the status line reads "Working" and the chips name the agent and model
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
      Then the status line reads "Stopped by you" and I am still on the Conversation
      Given the box has no focus
      When I press Escape
      Then I am on the board

    Scenario: The conversation is the whole record, with no event log
      Then the Conversation header shows no "Transcript / Ledger" control
      When the run ends
      Then the end line offers "Read the report" and no "Event log"

  Rule: Stop then continue
    Stop ends the run as the agent ends a cancelled turn; continuing is what the agent supports.

    Background:
      Given a paired browser at 1440 px and INC-1 has a run in progress on OpenCode

    Scenario: Stop ends the run
      When I press "Stop" in the box
      Then the status line reads "Stopped by you" and the conversation ends with "Stopped by you at <time> after <elapsed>", and no "Failed"
      And nothing counts down or waits

    Scenario: Continue a stopped run to a report
      Given INC-1's run was stopped and OpenCode can reopen it
      Then the box reads "Say what to change, or just continue" and no note explains it
      When I type "Only look at the 14:02 deploy" and press Enter
      Then the run is working again and the agent's next message answers with what it had already found
      When the run finishes
      Then the Report tab shows a report

    Scenario: A finished run takes follow-ups, the report stays
      Given INC-1's run finished with a report
      When I send "Why the 14:02 deploy?" from the box reading "Ask about this run"
      Then the agent answers in the conversation and the report is unchanged

    # T10 (#673 w59, OBJ-003): report presence gates the Report tab, not the run's state.
    Scenario: The report stays open while an answer runs
      Given INC-1's run finished with a report
      And an answer to a question is running on it
      Then the Report tab shows the report and the Overview's report pool shows it, the answer working under it

    # T23 (#673 w59, OBJ-013)
    Scenario: Investigate again carries the box and the report into a new run
      Given INC-1's run finished with a report
      When I type "Only the 14:02 deploy" and attach "notes.log", then press "Investigate again"
      Then a draft opens holding "Only the 14:02 deploy", the file "notes.log" and the quote "Re-check Run #"
      And the report is unchanged

    # T24 (#673 w59, §3, OBJ-003, OBJ-007)
    Scenario: A stopped reportless run reads Stopped by you and offers both verbs
      When I press "Stop" in the box
      Then the status line reads "Stopped by you" and the verb chip offers "Investigate" and "Ask"

    Scenario: A chat in Error reads Ended after it answers
      Given the run is a chat that ended in an error
      Then the status line reads "Error"
      When the chat answers a message
      Then the status line reads "Ended"

    Scenario: A message to an older thread is refused while another works
      When I press "Stop" in the box
      And another run on INC-1 starts working
      Then the stopped run's box says "is working; message it or stop it" and sends nothing

    Scenario: An agent that cannot continue says so
      Given the run was on deepagents and was stopped
      Then the box reads "This run can't continue. Start a new run." with "New run", and no field to type into

  Rule: Agent controls

    Background:
      Given a paired browser at 1440 px
      And INC-1 is Triggered with no run yet

    Scenario: The model reaches the agent
      Given Codex is picked with "GPT-5.6"
      When a run starts
      Then the report's header names no agent or model, and the conversation shows the agent accepting "GPT-5.6" before its first words
      Given the agent will not take the model
      Then the run does not start and its end line says which models it offered

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
      Then the phone's status line reads "Stopped by you" and its box reads "Say what to change, or just continue"
