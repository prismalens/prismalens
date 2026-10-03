# flows-v3.feature, @pr2: Alert sources.
@pr2
Feature: Alert sources

  Scenario: A stranger can copy the webhook with its token
    When I open Settings, Alert sources
    Then I see the Alertmanager webhook URL and a masked token with "Show" and "Copy"
    When I press "Show"
    Then the token is readable
    When an Alertmanager delivery arrives with that token as the bearer token
    Then "Last delivery" reads "1 alert, accepted"

  Scenario: Adding a source to pull from
    When I press "Add a source"
    Then the kinds offered are "Alertmanager" and "Prometheus"
    When I choose Alertmanager, enter "http://127.0.0.1:9093" and "Lab Alertmanager" and press "Add"
    Then a row "Lab Alertmanager" appears under "Pulled from" with its URL and "reachable" or the last error
    And there is no "Connections" section in Settings
