# flows-v3.feature, @pr2: First run.
@pr2
Feature: First run

  Background:
    Given a paired browser on a workspace with no incidents

  Scenario: Only the panel
    When I open the board
    Then I see four numbered steps, a done step reading "Done" in green, and no column headings, filter, time window or counts
    And step 1 offers "Copy URL" and "Copy token" separately
    And the only way to create an incident by hand is "New" in the header

  Scenario: A blocked clipboard never reads "Copied"
    When I open the board in a browser that blocks the clipboard
    And I press "Copy URL" in step 1
    Then a toast reads "Not copied" and none reads "Copied URL"

  Scenario: Unfinished steps stay visible after the first incident
    Given a coding agent is on PATH and no service names its code
    When the first alert arrives
    Then the board shows the card and one line above the columns reading "Setup, 3 of 4 done" with "Add a service"
    When I add a service with a folder
    Then the line goes

  Scenario: No agent on this machine
    Given no coding agent is on PATH
    Then step 3 reads which agents PrismaLens looks for and how to install one
    When I open an incident
    Then the box reads "No coding agent on this machine" with the install line, and "Start investigation" is withheld
