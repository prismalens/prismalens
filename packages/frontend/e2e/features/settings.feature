# flows-v3.feature, @pr2: Settings.
@pr2
Feature: Settings

  Scenario: Usage data is one line, a switch and a disclosure
    When I open Settings, Usage data
    Then above the fold I see one sentence naming the install id, one switch "Share usage counts", and a closed "What is sent" disclosure
    When I open the disclosure
    Then I can read what is sent, what is never sent, the install id and consent, and retention
    When I turn the switch on and reload
    Then the switch is on and "Recently sent" lists the setup event

  Scenario: Every section looks like the others
    When I open each Settings section in turn
    Then a visual snapshot of each matches its approved render at 1440 and 390
