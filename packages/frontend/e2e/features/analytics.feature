# flows-v3.feature, @pr2: Analytics.
@pr2
Feature: Analytics

  Scenario: The answer first
    Given 3 resolved incidents in the last 30 days
    When I open Incidents, Analytics
    Then the first line reads how many incidents, how many resolved, and the median time to resolve
    And four numbers follow: incidents, median time to resolve, investigated by the agent, open now, each with one line of comparison
    And a bar per day coloured by severity, then incidents by service and by recorded cause
    And no number sits in a framed box and no line reads "updated 0s ago"

  Scenario: The board's window becomes 30 days
    Given 3 resolved incidents in the last 30 days
    When I pick 24 hours on the board and switch to Analytics
    Then the window reads "Last 30 days" and a bar per day covers 30 days

  Scenario: Three kinds of month
    Given 7 open incidents and 3 needing me
    Then the first line reads how many are open and "3 need you now" as a link to Needs you
    Given a month worse than the one before
    Then the first line says so and each number shows what it was before
    And the numbers include median time to acknowledge, and "agent's cause matched yours" sits below them captioned as a five-bucket match on incidents where I recorded a category
    And "time to resolve" is measured to my Resolve, with "time until alerts cleared" shown as its own figure

  Scenario: Empty
    Given no incidents in the window
    Then the page reads "No incidents in the last 30 days" and offers a wider window
