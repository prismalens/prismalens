# flows-v3.feature, @pr2: First run.
@pr2
Feature: First run

  Background:
    Given a paired browser on a workspace with no incidents

  Scenario: Only the box
    When I open the board
    Then I see one question and the box, and no column headings, filter, time window or counts
    And no header offers "Log incident"

  Scenario: Alerts with none yet offers the webhook
    When I open the board
    And I open Alerts
    Then it offers the webhook URL and the token to copy separately

  Scenario: A blocked clipboard never reads "Copied"
    When I open Alerts in a browser that blocks the clipboard
    And I press Copy on the webhook URL
    Then a toast reads "Not copied" and none reads "Copied URL"

  Scenario: Unfinished steps stay visible after the first incident
    Given a coding agent is on PATH and no service names its code
    When the first alert arrives
    Then the inbox shows the row and one line above Needs you reading "One setup step left" with "Link code"
    When I add a service with a folder
    Then the line goes

  Scenario: No agent on this machine
    Given no coding agent is on PATH
    Then Home's setup line opens Settings, Agent
    When I open an incident's Conversation
    Then the box reads "No coding agent on this machine" with the install line, and "Investigate" is withheld
