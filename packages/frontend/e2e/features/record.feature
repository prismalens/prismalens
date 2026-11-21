# flows-v3.feature, @pr3, the part design PR 3a builds: the record, the report,
# connection lost on a run, and an agent that is not signed in. The conversation,
# the box, Stop then continue, attachments and two devices are PR 3b's.
@pr3
Feature: The incident record and its report

  Rule: Shell and Back

    Background:
      Given a paired browser at 1440 px
      And incident INC-1 "BooklogrApiLatencyP99High" on service "Booklogr API" with one alert

    Scenario: Connection lost is visible, and nothing pretends to be live
      Given the API stops answering while I am on INC-1's Conversation
      Then within 10 seconds a line at the top of the page reads "Connection lost, retrying. What you see is as of <time>"
      And the status line's state goes grey and its elapsed time stops
      When the API answers again
      Then the line goes and the conversation shows what arrived meanwhile

  Rule: Incident page

    Background:
      Given a paired browser at 1440 px
      And INC-1 is Triggered with no run yet

    Scenario: Live Overview
      Given a run is working
      When I open the Overview
      Then the summary says a run is working and its current step, and the Report section reads "Run #1 working"

  Rule: Report
    The run's conclusion ends its conversation under the summary; the evidence behind it is
    the details panel's Incident tab (#1101 moved it off the overview's why card).

    Scenario: A report with a cause
      Given INC-1's run finished naming "Checkout calls the payment provider with no timeout"
      When I open the Report tab
      Then the conversation ends on "Run 1 concluded: likely cause" under the report's summary
      And "Likely cause" heads the cause with its evidence, and an evidence step shows that step in the conversation
      And "Not checked" lists each gap with a way to connect a source
      And "Stop the impact" and the agent's suggested next steps say what to do now
      And "Ruled out" lists what the run excluded, and no "Event log"
      And "Export" is in the header's menu

    Scenario: A report with no cause
      Given the run finished with no root cause and one supported finding
      Then the conversation ends on "Run 1 concluded: no cause named" and the panel heads the leading idea "No cause named"
      And the supported finding leads under it as an idea, never as the cause
      And a refused query appears under "Not checked"

    Scenario: A failed run
      Given the run failed with "Not logged in. Run claude /login"
      When I open the Report tab
      Then I read "No report", the agent's own error verbatim, that the alert still fires, and the conversation ends on the failure
      And the run strip offers "Retry"

    Scenario: A late failure keeps what the conversation holds
      Given the run failed after 9 minutes with findings in the conversation
      When I open the Report tab
      Then I read "No report" and "The run failed before it reported.", and the conversation keeps what the run did

    Scenario: The first screen on a phone
      Given a phone at 390 px and INC-1's report names a cause
      When I open the Report tab
      Then without scrolling I see the summary of the cause, the alert, and the conclusion with its first step
      And "Export" sits in the header's menu, beside the run

    Scenario: A stopped run
      Given the run was stopped
      When I open the Report tab
      Then I read "No report" and when it was stopped, with a link to the conversation, and the box there offers to continue where the agent can reopen its session


  Rule: Agent not signed in

    Scenario: The harness's own words
      Given Claude Code is installed and not signed in
      When a run starts on it
      Then within a minute the card is in "Needs you" reading "Run failed"
      And the Conversation's end line and the Report tab show "Not logged in. Run claude /login" verbatim
      And no screen says PrismaLens will sign in for me
