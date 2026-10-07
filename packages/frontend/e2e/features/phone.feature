# flows-v3.feature, @pr1: Phone. Each scenario sets a 390 px viewport itself,
# so it holds on the desktop project too; the phone projects run it nightly.
@pr1 @responsive
Feature: Phone
  The doors are a strip; the list is the page; deep links have a way back.

  Background:
    Given a paired phone at 390 px

  Scenario: Landing
    When I open the app
    Then the top strip shows Incidents, Alerts, Services and Settings as icons, with Incidents current, and the header carries "New incident"
    And the incident list is the page

  Scenario: Deep link from Slack to a report, no history
    Given a fresh tab opens INC-1's Report from a Slack link
    Then the incident opens on its Report tab
    When I press the chevron at the left of the band
    Then I am on the incident list

  Scenario: New incident from the phone
    When I press "New incident" in the header
    Then the create dialog opens and fits the screen without sideways scrolling

  Scenario: Settings on the phone lands on its sections
    When I press Settings in the strip
    Then I see the list of sections; pressing one opens it, and Back returns to the list
