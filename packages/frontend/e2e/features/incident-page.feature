# flows-v3.feature, @pr2: Incident page.
@pr2
Feature: Incident page

  Background:
    Given a paired browser at 1440 px
    And INC-1 is Triggered with no run yet

  Scenario: One primary action, the same on every tab
    When I open INC-1 and each of its tabs in turn
    Then the band reads "Acknowledge" on each
    When I acknowledge
    Then the band reads "Resolve" on every tab and never "Investigate"
