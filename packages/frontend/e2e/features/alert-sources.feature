# flows-v3.feature, @pr2: Alert intake (#848).
@pr2
Feature: Alert intake

  Scenario: A stranger can copy the webhook with its token
    When I open Settings, Alert intake
    Then I see the Alertmanager webhook URL and a masked token with "Show" and "Copy"
    When I press "Show"
    Then the token is readable
    When an Alertmanager delivery arrives with that token as the bearer token
    Then "Last delivery" reads "1 alert, accepted"

  Scenario: Adding a source to pull from
    When I press "Add a source"
    Then the kinds offered include "Alertmanager" and "Prometheus"
    When I choose Alertmanager, enter "http://127.0.0.1:9093" and "Lab Alertmanager", test it and save
    Then a row "Lab Alertmanager" appears under "Pulled by URL" with its address and a state word
    And there is no "Connections" section in Settings
