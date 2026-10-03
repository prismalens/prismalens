# flows-v3.feature, @pr2: Shell and Back.
@pr2
Feature: Shell and Back
  Four doors in the sidebar, always lit where you are; one way back from every
  leaf, and it goes to where you came from.

  Background:
    Given a paired browser at 1440 px
    And incident INC-1 "BooklogrApiLatencyP99High" on service "Booklogr API" with one alert

  Scenario: Back from a service
    When I open Services, then "booklogr-api", and press the chevron
    Then I am on the services list
    When I open "booklogr-api" again and press Escape
    Then I am on the services list
