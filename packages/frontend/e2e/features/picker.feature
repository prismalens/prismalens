# flows-v3.feature, @pr2: Agent and model picker.
# #673 w7's rail is back: Starred, one tile per agent that can run, Add agent; the list
# beside it holds the shown tile's models under their providers.
@pr2
Feature: Agent and model picker

  Scenario: Each agent is a tile on the rail, with Starred first
    Given OpenCode, Claude Code and Codex are installed and deepagents is not
    When I open the picker in Settings, Models
    Then the rail has Starred, a tile per installed agent and Add agent, and none for deepagents
    And OpenCode's tile shows its models by their own names, no Default row, each named once
    When I type "sonnet" in the search
    Then only models matching "sonnet" remain
    When I star "Claude Sonnet 5.5"
    Then it is listed under Starred and first on OpenCode's tile on the next open

  Scenario: The box's chips follow what the agent supports
    When I pick Codex and open a new run's draft
    Then the effort chip reads Codex's default "Medium", and its menu tags it "Codex's pick"
    And the model chip's list is the one Codex offers, with no "List its models"
    When I pick Claude Code and open a new run's draft
    Then the effort chip is locked and says "Claude Code sets its own effort"
    And every agent's access chip lists its own modes, or the four levels where it lists none, the one a run takes ticked

  Scenario: The access chip lists the agent's own modes, the level a run takes named for it
    When I pick Codex and open a new run's draft
    Then the access chip reads "Ask always"
    When I open the access chip
    Then the popover lists Codex's three modes with "Ask always" first and ticked


  # #1020: what Send does reads above the box; the other actions are under "/".
  Scenario: The box says what the next message asks for
    When I pick Codex and open a new run's draft
    Then the box's action reads "Investigate" and "/" offers "/ask" alone
    When I pick "/ask" under "/"
    Then the box's one send control is the arrow and its placeholder reads "Ask about this incident"

  Scenario: A chip changes only this run, never Settings
    Given OpenCode and Codex are checked and Settings names OpenCode
    When on a new run's draft I pick Codex's "GPT-5.6" and "High" effort in the box
    Then Settings still names OpenCode, with no model or effort for Codex
    And the box still reads "GPT-5.6" and "High" after I open Alerts and come back
    When I press "Investigate" in the box
    Then the run asks for Codex, "gpt-5.6" and "high", and keeps them on the run

  Scenario: One model has one name, and a training tier says so
    Given OpenCode offers "Claude Sonnet 5.5" and "DeepSeek V4.1 Flash (free)"
    When I choose "Claude Sonnet 5.5"
    Then the picker's chip, the Settings row and the box on an incident all read "Claude Sonnet 5.5"
    And "DeepSeek V4.1 Flash (free)" carries the warning "Trains on your prompts" and the picker ticks one model by its name, with no Default row

  Scenario: Rows carry their maker's mark, each tile holds its agent's models, Starred holds favourites across agents
    Then every row on an agent's tile carries a mark, and each tile shows only its agent's models
    When I open the picker with a model starred on OpenCode and on Claude Code
    Then both are on the Starred tile, each with its agent's mark
