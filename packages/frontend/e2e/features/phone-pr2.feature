# flows-v3.feature, @pr2: Phone.
@pr2 @responsive
Feature: Phone
  The doors are a strip; the list is the page; deep links have a way back.

  Background:
    Given a paired phone at 390 px

  Scenario: Acknowledge in two taps from a push link
    Given a push link opens INC-4
    When I press "Acknowledge" in the band
    Then the band reads "Acknowledged" and the list shows INC-4 under Working

  Scenario: Analytics on the phone
    When I open Incidents, Analytics
    Then the answer line and the numbers fit the screen two per row, and nothing scrolls sideways
