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

    Scenario: Overview is one column with headings as links
      When I open INC-1's Overview
      Then I see a summary with a "Next" line, then "Report", "Alerts", "Timeline" and a note field, in one column with nothing beside it
      And no "See all", "Open conversation", "Details" or "Read the report" links
      When I press "All events" on the Timeline pool
      Then I am on the Timeline tab

    Scenario: Live Overview
      Given a run is working
      When I open the Overview
      Then the summary says a run is working and its current step, and the Report section reads "Run #1 working"

    Scenario: The Timeline follows Acknowledge without a reload (#673 walk 4)
      When I open INC-1's Overview
      And I read the Timeline tab's count
      When I press Acknowledge
      Then the Timeline count is higher and the list shows an "Acknowledged" entry, without reload or navigation

  Rule: Report
    Four slots above the fold, four variants.

    Scenario: A report with a cause
      Given INC-1's run finished naming "Checkout calls the payment provider with no timeout"
      When I open the Report tab
      Then the first thing I read is a confidence word ("Likely") and the cause as a headline, with inline code rendered
      And "Why we think so" lists up to three evidence lines, each marked For or Against and seen or inferred, each with a link that opens the command or file in the Conversation
      And "What we could not check" lists each gap as a sentence
      And "Do now" is a checklist with one sentence saying PrismaLens did not run the steps
      And below the fold: "Ruled out" and "Grounded in" as a list of paths one per line, and no "Event log"
      And "Export" and "Post to GitHub" are at the top right of the report's header

    Scenario: A report with no cause
      Given the run finished with no root cause and one supported finding
      Then the first thing I read is "No cause found" and a headline saying what stopped it
      And the supported finding appears under "What it did find", never as the answer
      And a refused query appears under "What we could not check" with its plain reason

    Scenario: A failed run
      Given the run failed with "Not logged in. Run claude /login"
      When I open the Report tab
      Then I read "No report", the agent's own error verbatim, a line saying whether the alert still fires, and a link to the conversation
      And the band's menu offers "New run"

    Scenario: A late failure keeps what the conversation holds
      Given the run failed after 9 minutes with findings in the conversation
      When I open the Report tab
      Then I read "No report. The run failed after 9m." and how many commands and files it got through, with a link to the Conversation

    Scenario: The first screen on a phone
      Given a phone at 390 px and INC-1's report names a cause
      When I open the Report tab
      Then without scrolling I see the confidence word, the cause, and the summary of the cause, the first "Do now" step and the alert
      And "Export" and "Post to GitHub" sit in the report's header, beside the run

    Scenario: Hand the fix to my own agent
      When I press "Copy fix brief" in the report's menu
      Then the clipboard holds the cause, the commit, the evidence sources and the open steps as text
      Given the report's first step is "Map Booklogr API to its repository"
      Then that step is a link to the service page, not a checkbox

    Scenario: A stopped run
      Given the run was stopped
      When I open the Report tab
      Then I read "No report" and when it was stopped, with a link to the conversation, and the box there offers to continue where the agent can reopen its session

    Scenario: Ticking a step is shared
      When I tick the first "Do now" step
      Then the heading reads "1 of 3 done" and "Done by you at <time>"
      And another paired browser sees the tick without a reload

  Rule: Agent not signed in

    Scenario: The harness's own words
      Given Claude Code is installed and not signed in
      When a run starts on it
      Then within a minute the card is in "Needs you" reading "Run failed"
      And the Conversation's end line and the Report tab show "Not logged in. Run claude /login" verbatim
      And no screen says PrismaLens will sign in for me
