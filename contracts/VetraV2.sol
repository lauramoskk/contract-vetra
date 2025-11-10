// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Vetra.sol";

/**
 * @title VetraV2
 * @notice Mock upgraded version of Vetra for testing upgradeability
 * @dev Adds a new function to test that upgrades preserve state and roles
 */
contract VetraV2 is Vetra {
    // New state variable (will be added after existing storage)
    string public version;

    /**
     * @notice Initialize V2 specific features
     * @dev Called after upgrade to set V2-specific state
     */
    function initializeV2() public reinitializer(2) {
        version = "2.0.0";
    }

    /**
     * @notice New function added in V2
     * @return Current version string
     */
    function getVersion() public view returns (string memory) {
        return version;
    }

    /**
     * @notice Test function to verify upgrade worked
     * @return A test message
     */
    function testUpgrade() public pure returns (string memory) {
        return "Upgrade successful - VetraV2";
    }
}
