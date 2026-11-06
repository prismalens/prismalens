# flows-v3.feature, @pr1: Shell and Back, and the alert page without Acknowledge.
@pr1
Feature: Shell and Back
  Four doors in the sidebar, always lit where you are; one way back from every
  leaf, and it goes to where you came from.

  Background:
    Given a paired browser at 1440 px
    And incident INC-1 "BooklogrApiLatencyP99High" on service "Booklogr API" with one alert

  Scenario: The sidebar lights the area I am in
    When I open the board
    Then the sidebar shows Threads, Automation, Services, Operations and Settings with Operations current
    And the sidebar lists INC-1
    When I open Automation
    Then Automation is current, the page offers schedules and alerts, and the sidebar keeps the threads

  Scenario: One primary on the board and Services, none on Alerts or Settings
    When I open the board, then Alerts, then Services, then Settings
    Then the board shows one "Log incident", Services one "New service", Alerts and Settings none, and nothing else creates
    When I press "Log incident" from the board and create "Checkout slow" on "Booklogr API"
    Then I am on the new incident's Overview

  Scenario: Back from an alert goes to where I came from
    Given I open the same alert from the Alerts door
    When I press the chevron
    Then I am on the alert list

  Scenario: Settings keeps the app's sidebar and Back returns to where I was
    Given I am on INC-1's Overview
    When I open Settings
    Then the page lists the settings sections beside the app's own sidebar
    When I press "Back"
    Then I am on INC-1's Overview
    When I open Settings and press Escape
    Then I am on INC-1's Overview

  Scenario: Shortcuts live in tooltips and the help sheet
    When I hover "Log incident" in the header
    Then the tooltip shows its shortcut
    When I press "?"
    Then a sheet lists the shortcuts
    And no screen shows a line of key names

  Scenario: Settings opened by a deep link keeps the way home
    Given a fresh tab opens Settings, Devices
    When I open New from the sidebar
    Then I am on Home

  Scenario: Acknowledging is the incident's
    When I open an alert that opened INC-1
    Then the alert's band offers "Open INC-1" and no "Acknowledge"
