# flows-v3.feature, @pr2: Agent and model picker.
@pr2
Feature: Agent and model picker

  Scenario: Agents are a rail, models a searchable list with favourites
    Given OpenCode, Claude Code and Codex are installed and deepagents is not
    When I open the picker in Settings, Agent
    Then the left rail shows a Starred tile and one tile per installed agent, and none for deepagents
    And the list shows the agent's own model first, then the models with their provider under each, no headings, each named once
    When I type "sonnet" in the search
    Then only models matching "sonnet" remain
    When I star "Claude Sonnet 5.5"
    Then it is listed under the Starred tile and first in OpenCode's list on the next open

  Scenario: The box's chips follow what the agent supports
    When I pick Codex and open a new run's draft
    Then the effort chip reads Codex's default "Medium", and its menu tags it "Default"
    And the model chip's list is the one Codex offers, with no "Run a check to list models"
    When I pick Claude Code and open a new run's draft
    Then the effort chip is disabled, reading "Default"
    And every agent shows its own default permission mode, by the agent's name once checked

  # #673 w59: the verb chip, first in a draft's footer, and its popover.
  Scenario: The verb chip says what the next message asks for
    When I pick Codex and open a new run's draft
    Then the verb chip reads "Investigate" and its menu explains "Investigate" and "Ask" with "Enter does what the chip says."
    When I pick "Ask" in the verb menu
    Then the box's one send control is the arrow and its placeholder reads "Ask about this incident"

  Scenario: A chip changes only this run, never Settings
    Given OpenCode and Codex are checked and Settings names OpenCode
    When on a new run's draft I pick Codex's "GPT-5.6" and "High" effort in the box
    Then Settings still names OpenCode, with no model or effort for Codex
    And the box still reads "GPT-5.6" and "High" after I open Alerts and come back
    When I press "Investigate" in the box
    Then the run asks for Codex, "gpt-5.6" and "high", and keeps them on the run

  Scenario: One model has one name, and a training tier says so
    Given OpenCode offers "Claude Sonnet 5.5" and "Muse Spark 1.3 (free)"
    When I choose "Claude Sonnet 5.5"
    Then the picker's chip, the Settings row and the box on an incident all read "Claude Sonnet 5.5"
    And "Muse Spark 1.3 (free)" carries the line "trains on your prompts" and the agent's own model shows what OpenCode reports, not a PrismaLens choice

  Scenario: Agents are shown by mark, the search names them, favourites across agents
    Then every rail tile is a tab showing the agent's mark and no label, and the search names the agent
    And the panel measures 380 by 400 px on every agent
    When I open the "Starred" tile
    Then my starred models from every agent are listed, each with its agent
