@responsive
Feature: The board on any screen
  Phone, tablet and desktop get the same board; nothing hides off the right edge.

  Scenario: The Inbox loads
    Given the Inbox is open
    Then the page does not scroll sideways
