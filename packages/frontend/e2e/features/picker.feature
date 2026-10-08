# flows-v3.feature, @pr2: Agent and model picker.
@pr2
Feature: Agent and model picker

  Scenario: Agents are a rail, models a searchable list with favourites
    Given OpenCode, Claude Code and Codex are installed and deepagents is not
    When I open the picker in Settings, Agent
    Then the left rail shows one tile per agent with deepagents dimmed
    And the list shows "Agent default" first, then my favourites, then models grouped by provider, each named once
    When I type "sonnet" in the search
    Then only models matching "sonnet" remain
    When I star "Claude Sonnet 5.5"
    Then it appears under Favourites on the next open

  Scenario: Controls appear only when the agent supports them
    When I pick Codex
    Then an effort control appears reading Codex's default, and the model list Codex offers ("pending a check" until the admission probe has run)
    When I pick Claude Code
    Then the model list appears and no effort control
    And every agent shows its own default permission mode, by the agent's name once checked

  Scenario: One model has one name, and a training tier says so
    Given OpenCode offers "Claude Sonnet 5.5" and "Muse Spark 1.3 (free)"
    When I choose "Claude Sonnet 5.5"
    Then the picker's chip, the Settings row and the box on an incident all read "Claude Sonnet 5.5"
    And "Muse Spark 1.3 (free)" carries the line "trains on your prompts" and "Agent default" shows what OpenCode reports, not a PrismaLens choice

  Scenario: Agents are shown by mark, the panel names them, favourites across agents
    Then every rail tile is a tab showing the agent's mark and no label, and the list opens with the agent's name
    And the panel measures 440 by 360 px on every agent
    When I open the "Starred" tile
    Then my starred models from every agent are listed, each with its agent
