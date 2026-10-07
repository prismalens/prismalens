# flows-v3.feature, @pr2: Board.
@pr2
Feature: Board

  Background:
    Given a paired browser at 1440 px on a workspace with INC-1 open and a run in progress

  Scenario: Card anatomy
    Then INC-1's card shows one severity dot, "INC-1", the service and age on the first line, the title on its own line, and the run's current step with a ticking elapsed time
    And no card shows a second dot or a severity word

  Scenario: An unacknowledged incident with a live run sits in Needs you
    Given INC-1 is Triggered and its run is working
    Then INC-1's card is in "Needs you" reading "Needs acknowledging" with the run's step under it and an "Acknowledge" button on the card
    When I press "Acknowledge" on the card
    Then the card moves to "Working" without a reload

  Scenario: Needs you is ordered
    Given one Triggered incident, one whose run failed, one reopened by me and one whose alerts cleared
    Then "Needs you" lists them in that order, with the cleared one under a quiet "To wrap up" heading

  Scenario: The sidebar's mark follows the board
    Given an incident in "Needs you"
    When I open any screen
    Then its sidebar row carries the red mark, a working run's row the teal mark, and a resolved incident's row no mark

  Scenario: Column words say what is left to do
    When the run finishes with a report
    Then the card is in "Concluded" with "Likely:" and the cause
    When the alert clears in Alertmanager
    Then the card is in "Needs you" reading "Alerts cleared"
    When I resolve INC-1 with a cause
    Then the card is in "Resolved" with "Cause:" and the text
    And no column or card says "Closed" or "Awaiting close"

  Scenario: A new alert's card appears without a reload
    When an Alertmanager delivery for a new alert arrives
    Then within 2 seconds the card is on the board and the sidebar's Incidents count went up by one
    And the card is marked new, and a second arrival a second later starts its own glow at once and leaves the first one's to end

  Scenario: A stale run looks different from a live one
    Given the run has sent nothing for 5 minutes
    Then the card's step line reads "Working 14m, quiet for 5 min" in the warning colour

  Scenario: Widths
    Given the viewport is 1024 px wide
    Then the sidebar is a rail of icons and every card's title and service are readable, none cut to one letter
    Given the viewport is 390 px wide
    Then the columns stack with their headings and nothing scrolls sideways

  Scenario: Dropping a card on Working starts a run
    Given the agent is ready and INC-1 is in "Concluded"
    When I drag INC-1's card to "Working"
    Then a run starts at once and the card shows its step, with no form under the card
    Given INC-1 is Resolved
    When I drag its card to "Working"
    Then a dialog asks "Reopen INC-1 and investigate?"

  Scenario: Dropping a resolved card on Concluded asks, then reopens
    Given INC-1 is Resolved
    When I drag its card to "Concluded"
    Then a dialog asks "Reopen INC-1?"
    When I confirm the reopen
    Then INC-1 reads "Acknowledged", its card has left "Resolved", and no run started

  Scenario: Reopen and investigate with no agent frees the card
    Given INC-1 is Resolved with a cause
    And no coding agent is on PATH
    When I drag its card to "Working"
    And I confirm the reopen
    Then a toast reads "No run started" and the card no longer reads "Reopening"
