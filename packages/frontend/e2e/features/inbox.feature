# flows-v3.feature, @pr2: the inbox that replaced the board (#811).
@pr2
Feature: Inbox

  Background:
    Given a paired browser at 1440 px on a workspace with INC-1 open and a run in progress

  Scenario: Group words say what is left to do
    Then INC-1 is under Working, and in no Needs you group
    When the run finishes with a report
    Then INC-1 is under "Finding ready" with "Likely:" and the cause
    And INC-1 is not under Working
    When the alert clears in Alertmanager
    Then INC-1 is under "Alerts cleared" reading "Cleared"
    When I resolve INC-1 with a cause
    Then INC-1 is in Recently resolved reading "Resolved by you"
    And no group or row says "Closed" or "Awaiting close"

  Scenario: A new alert's row appears without a reload
    When an Alertmanager delivery for a new alert arrives
    Then within 2 seconds the row is in the inbox and the sidebar's Incidents count went up by one
    And the row is marked new, and a second arrival a second later is marked new while the first one's mark ends

  Scenario: Widths
    Given the viewport is 1024 px wide
    Then every row's title is readable, none cut to one letter
    Given the viewport is 390 px wide
    Then nothing scrolls sideways

  Scenario: Investigating again from a row starts a run
    Given the agent is ready and INC-1 is under "Finding ready"
    When I pick "Investigate again" in INC-1's row menu
    Then a run starts at once, with no form on the page

  # T21 (#673 w59, OBJ-014, OBJ-008): Stop and Resolve act on the live thread, not the newest.
  Scenario: Resolve stops whichever turn is live: a resumed older run
    Given INC-1's live run sits under a newer finished run
    When I resolve INC-1 from its row menu and confirm a cause
    Then the Stop went to the live run, not the newest, and INC-1 is Resolved

  Scenario: Resolve stops whichever turn is live: a live chat
    Given INC-1's live run is a chat answering a question
    Then INC-1 is under "No cause found", a chat is not a run working on it
    When I resolve INC-1 from its row menu and confirm a cause
    Then the Stop went to the live run, not the newest, and INC-1 is Resolved
