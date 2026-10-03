@responsive
Feature: The board on any screen
  Phone, tablet and desktop get the same board; nothing hides off the right edge.

  Scenario: The incidents board loads
    Given the incidents board is open
    Then the page does not scroll sideways
