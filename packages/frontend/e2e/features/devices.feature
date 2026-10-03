# flows-v3.feature, @pr1: Pair a phone, and Settings, Devices.
@pr1
Feature: Pair a phone, and the devices that can reach this instance

  Scenario: A used link says so and says where to get one
    Given a pairing link that was already redeemed
    When I open it on the phone
    Then I read that the link has been used and that links work once for 15 minutes
    And I read the two ways to get a new one: Settings, Devices, or "pl pair --tailscale"

  Scenario: A fresh link pairs without a click
    Given a fresh pairing link
    When I open it on the phone
    Then I am on the incident list and Settings, Devices lists the phone by its model name

  Scenario: Devices carry the device's name and OS and can be renamed
    Given the host browser is paired and a phone "Pixel 9" is paired
    When I open Settings, Devices
    Then the first row reads the host's hostname and this browser's name, and is marked "this device"
    And the row for "Pixel 9" reads "Chrome on Android"
    When I rename "Pixel 9" to "Sumit's phone" and reload
    Then a row reads "Sumit's phone"

  Scenario: Revoking the device I am using asks first and says what happens
    Given I am on Settings, Devices
    When I press Revoke on the row marked "this device"
    Then a confirmation says this browser loses access until I run "pl pair --operator"
    When I cancel
    Then the row is still paired
