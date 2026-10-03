# flows-v3.feature, @pr2: Resolve, reopen, refire.
@pr2
Feature: Resolve, reopen, refire

  Scenario: Resolve is one step and warns about firing alerts
    Given INC-1 is Acknowledged with one alert still firing
    When I press "Resolve" in the band
    Then the dialog says 1 alert is still firing and that a refire opens a new incident naming this one
    And "Cause" is prefilled with the report's answer in the normal text colour, labelled "from the report, edit if wrong", and "Category" is prefilled from the report
    When I press "Resolve"
    Then the band reads "Resolved" with "Reopen" as its action
    And the Overview shows "Cause" with the text and an "Edit" control
    And the alert reads resolved with the incident

  Scenario: Alerts cleared is not Resolved
    Given INC-1 is Acknowledged
    When the source resolves its alert
    Then the band reads "Alerts cleared" with "Resolve" as its action and the card sits in "Needs you"

  Scenario: The same alert fires again on a Resolved incident
    Given INC-1 is Resolved with cause "pool capped at 10"
    When the same alert fires again
    Then within 2 seconds a new incident's card is in "Needs you" reading "Fired again: after INC-1 was resolved, cause: pool capped at 10"
    And INC-1 stays Resolved, and INC-1's card and Overview read "Fired again as INC-11, <time>"

  Scenario: The same alert fires again on Alerts cleared
    Given INC-1 reads "Alerts cleared" and the flap window is open
    When the same alert fires again
    Then INC-1's card is in "Needs you" reading "Back again" and the band reads "Triggered"

  Scenario: Reopen keeps the old cause
    Given INC-1 is Resolved with a cause
    When I press "Reopen" and confirm
    Then the band reads "Acknowledged", the Overview shows "Previous cause", and the card is in "Needs you" reading "Reopened by you, cause not confirmed"
    When I start a run from the box
    Then the card moves to "Working"
