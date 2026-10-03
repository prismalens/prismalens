Feature: Live updates
  The board shows what happens while it is open; nobody reloads to find out.

  Scenario: A new incident appears without a reload
    Given the incidents board is open
    When Alertmanager fires "BoardLiveArrival"
    Then an incident for "BoardLiveArrival" appears within 5 seconds without a reload
