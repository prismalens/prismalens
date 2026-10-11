# flows-v3.feature, @pr2: Incident page.
@pr2
Feature: Incident page

  Background:
    Given a paired browser at 1440 px
    And INC-1 is Triggered with no run yet

  Scenario: One primary action on the overview
    When I view INC-1's Overview
    Then the header shows "Resolve" and never "Investigate"
