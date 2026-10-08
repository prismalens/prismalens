# flows-v3.feature, @pr2: Services.
@pr2
Feature: Services
  A door of its own; a service is one page that says what a run reads and what it depends on.

  Scenario: The list says what each service is
    When I open Services
    Then each row shows the name, its kind (Service, Database, Gateway, …), its code source as a folder path or host/owner/repo, its telemetry, and its open incidents

  Scenario: One page, Back at the band
    When I open "booklogr-api"
    Then I see "Code the run reads", "Telemetry", "Dependencies", "Runs" and "Incidents" on one page with no tabs
    And the band shows the kind, tier and team
    When I add "booklogr-db" as an upstream dependency
    Then it appears under "Dependencies" as "Database, upstream"
