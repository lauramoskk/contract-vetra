// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import "@chainlink/contracts/src/v0.8/functions/v1_0_0/interfaces/IFunctionsRouter.sol";

/**
 * @title Vetra
 * @notice 1:1 USD-backed stablecoin with Chainlink Functions proof-of-reserves
 * @dev Upgradeable ERC20 token with role-based access control and reserve validation
 */
contract Vetra is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using FunctionsRequest for FunctionsRequest.Request;

    // =============================================================
    //                             ROLES
    // =============================================================

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    // =============================================================
    //                       RESERVE CONFIGURATION
    // =============================================================

    /// @notice Reserve amount in USD (scaled by RESERVE_SCALE_FACTOR)
    /// @dev Represents USD with 8 decimal places (e.g., 100000000 = $1.00)
    uint256 public lastReserveUsd;

    /// @notice Timestamp of last successful reserve update
    uint256 public lastReserveTimestamp;

    /// @notice Monotonic nonce to prevent replay attacks
    uint256 public lastReserveNonce;

    /// @notice Maximum age of reserve data in seconds (15 minutes)
    uint256 public reserveTTL;

    /// @notice Reserve scale factor (8 decimals = 10^8)
    /// @dev Reserve API returns USD with 8 decimals, token has 18 decimals
    uint256 public constant RESERVE_SCALE_FACTOR = 1e8;

    /// @notice Token decimals (18)
    uint256 public constant TOKEN_DECIMALS = 1e18;

    /// @notice Conversion factor from reserve to token (10^10)
    uint256 public constant RESERVE_TO_TOKEN_SCALE =
        TOKEN_DECIMALS / RESERVE_SCALE_FACTOR;

    // =============================================================
    //                    CHAINLINK CONFIGURATION
    // =============================================================

    address public functionsRouter;
    bytes32 public donId;
    uint64 public subscriptionId;
    uint32 public gasLimit;
    string public sourceCode;

    /// @notice Mapping of Chainlink Functions request IDs to request metadata
    mapping(bytes32 => RequestMetadata) public requests;

    struct RequestMetadata {
        address requester;
        uint256 timestamp;
        bool fulfilled;
    }

    // =============================================================
    //                      OPTIONAL POLICIES
    // =============================================================

    /// @notice Maximum amount that can be minted in a single transaction (0 = disabled)
    uint256 public mintPerTxLimit;

    /// @notice Whether allowlist is enabled
    bool public allowlistEnabled;

    /// @notice Mapping of addresses allowed to receive mints
    mapping(address => bool) public allowlist;

    // =============================================================
    //                            EVENTS
    // =============================================================

    event TokensMinted(
        address indexed to,
        uint256 amount,
        address indexed operator,
        uint256 totalSupplyAfter,
        uint256 reserveAfter,
        uint256 timestamp
    );

    event TokensBurned(
        address indexed from,
        uint256 amount,
        address indexed operator,
        uint256 totalSupplyAfter,
        uint256 timestamp
    );

    event ReserveUpdateRequested(
        bytes32 indexed requestId,
        address indexed requester,
        uint256 timestamp
    );

    event ReserveUpdated(
        uint256 usdAmount,
        uint256 nonce,
        uint256 timestamp,
        bytes32 indexed requestId
    );

    event ReserveTTLUpdated(uint256 oldTTL, uint256 newTTL);
    event MintLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event AllowlistStatusUpdated(bool enabled);
    event AllowlistAddressUpdated(address indexed account, bool allowed);
    event ChainlinkConfigUpdated(
        address router,
        bytes32 donId,
        uint64 subscriptionId
    );

    // =============================================================
    //                            ERRORS
    // =============================================================

    error ReserveStale(uint256 age, uint256 maxAge);
    error ReserveInsufficient(uint256 required, uint256 available);
    error NonceNotMonotonic(uint256 currentNonce, uint256 newNonce);
    error MintLimitExceeded(uint256 amount, uint256 limit);
    error RecipientNotAllowed(address recipient);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidConfiguration();

    // =============================================================
    //                          CONSTRUCTOR
    // =============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // =============================================================
    //                         INITIALIZER
    // =============================================================

    /**
     * @notice Initializes the Vetra stablecoin contract
     * @param _admin Address of the admin (can upgrade and manage config)
     * @param _minter Address of the minter
     * @param _burner Address of the burner
     * @param _reserveTTL Reserve time-to-live in seconds
     * @param _functionsRouter Chainlink Functions router address
     * @param _donId Chainlink DON ID
     * @param _subscriptionId Chainlink subscription ID
     * @param _gasLimit Gas limit for Chainlink Functions callback
     */
    function initialize(
        address _admin,
        address _minter,
        address _burner,
        uint256 _reserveTTL,
        address _functionsRouter,
        bytes32 _donId,
        uint64 _subscriptionId,
        uint32 _gasLimit
    ) public initializer {
        if (
            _admin == address(0) ||
            _minter == address(0) ||
            _burner == address(0) ||
            _functionsRouter == address(0)
        ) {
            revert InvalidAddress();
        }

        if (_reserveTTL == 0 || _gasLimit == 0) {
            revert InvalidConfiguration();
        }

        __ERC20_init("Vetra", "VTR");
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _minter);
        _grantRole(BURNER_ROLE, _burner);

        // Set reserve config
        reserveTTL = _reserveTTL;

        // Set Chainlink config
        functionsRouter = _functionsRouter;
        donId = _donId;
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;

        // Initialize reserve with zero values
        lastReserveUsd = 0;
        lastReserveTimestamp = 0;
        lastReserveNonce = 0;

        // Initialize optional policies as disabled
        mintPerTxLimit = 0;
        allowlistEnabled = false;
    }

    // =============================================================
    //                        MINT FUNCTION
    // =============================================================

    /**
     * @notice Mints new tokens if reserve is sufficient and fresh
     * @param to Recipient address
     * @param amount Amount to mint (18 decimals)
     */
    function mint(
        address to,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        // Check reserve freshness
        uint256 currentReserveAge = block.timestamp - lastReserveTimestamp;
        if (currentReserveAge > reserveTTL) {
            revert ReserveStale(currentReserveAge, reserveTTL);
        }

        // Check 1:1 backing invariant
        // Reserve is in 8 decimals, token is in 18 decimals
        uint256 reserveScaled = lastReserveUsd * RESERVE_TO_TOKEN_SCALE;
        uint256 newTotalSupply = totalSupply() + amount;

        if (newTotalSupply > reserveScaled) {
            revert ReserveInsufficient(newTotalSupply, reserveScaled);
        }

        // Check per-tx limit if enabled
        if (mintPerTxLimit > 0 && amount > mintPerTxLimit) {
            revert MintLimitExceeded(amount, mintPerTxLimit);
        }

        // Check allowlist if enabled
        if (allowlistEnabled && !allowlist[to]) {
            revert RecipientNotAllowed(to);
        }

        // Mint tokens
        _mint(to, amount);

        emit TokensMinted(
            to,
            amount,
            msg.sender,
            totalSupply(),
            lastReserveUsd,
            block.timestamp
        );
    }

    // =============================================================
    //                        BURN FUNCTIONS
    // =============================================================

    /**
     * @notice Burns tokens from an account
     * @param account Account to burn from
     * @param amount Amount to burn
     */
    function burnFrom(
        address account,
        uint256 amount
    ) external onlyRole(BURNER_ROLE) whenNotPaused {
        if (account == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        _burn(account, amount);

        emit TokensBurned(
            account,
            amount,
            msg.sender,
            totalSupply(),
            block.timestamp
        );
    }

    /**
     * @notice Allows users to burn their own tokens
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        _burn(msg.sender, amount);

        emit TokensBurned(
            msg.sender,
            amount,
            msg.sender,
            totalSupply(),
            block.timestamp
        );
    }

    // =============================================================
    //                  CHAINLINK FUNCTIONS REQUEST
    // =============================================================

    /**
     * @notice Requests reserve update via Chainlink Functions
     * @param _sourceCode JavaScript source code for Chainlink Functions
     * @param args Arguments for the source code (if any)
     * @return requestId The Chainlink Functions request ID
     */
    function requestReserveUpdate(
        string calldata _sourceCode,
        string[] calldata args
    )
        external
        payable
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (bytes32 requestId)
    {
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(_sourceCode);

        if (args.length > 0) {
            req.setArgs(args);
        }

        // Send request directly to router
        IFunctionsRouter router = IFunctionsRouter(functionsRouter);
        requestId = router.sendRequest(
            subscriptionId,
            req.encodeCBOR(),
            FunctionsRequest.REQUEST_DATA_VERSION,
            gasLimit,
            donId
        );

        requests[requestId] = RequestMetadata({
            requester: msg.sender,
            timestamp: block.timestamp,
            fulfilled: false
        });

        sourceCode = _sourceCode; // Store for reference

        emit ReserveUpdateRequested(requestId, msg.sender, block.timestamp);

        return requestId;
    }

    // =============================================================
    //                  CHAINLINK FUNCTIONS CALLBACK
    // =============================================================

    /**
     * @notice Chainlink Functions callback (called by router)
     * @param requestId The request ID
     * @param response The response data
     * @param err Any error from Chainlink Functions
     */
    function handleOracleFulfillment(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) external {
        // Only the router can call this
        if (msg.sender != functionsRouter) {
            revert InvalidAddress();
        }

        RequestMetadata storage request = requests[requestId];
        request.fulfilled = true;

        // If there's an error, we don't update reserve
        if (err.length > 0) {
            return;
        }

        // Decode response: (uint256 usdAmount, uint256 nonce)
        // Response should be ABI-encoded tuple
        (uint256 usdAmount, uint256 nonce) = abi.decode(
            response,
            (uint256, uint256)
        );

        // Enforce monotonic nonce
        if (nonce <= lastReserveNonce) {
            revert NonceNotMonotonic(lastReserveNonce, nonce);
        }

        // Update reserve data
        lastReserveUsd = usdAmount;
        lastReserveTimestamp = block.timestamp;
        lastReserveNonce = nonce;

        emit ReserveUpdated(usdAmount, nonce, block.timestamp, requestId);
    }

    // =============================================================
    //                     ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Updates the reserve TTL
     * @param _newTTL New TTL in seconds
     */
    function setReserveTTL(
        uint256 _newTTL
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newTTL == 0) revert InvalidConfiguration();
        uint256 oldTTL = reserveTTL;
        reserveTTL = _newTTL;
        emit ReserveTTLUpdated(oldTTL, _newTTL);
    }

    /**
     * @notice Updates the per-transaction mint limit
     * @param _newLimit New limit (0 to disable)
     */
    function setMintPerTxLimit(
        uint256 _newLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = mintPerTxLimit;
        mintPerTxLimit = _newLimit;
        emit MintLimitUpdated(oldLimit, _newLimit);
    }

    /**
     * @notice Enables or disables the allowlist
     * @param _enabled Whether allowlist is enabled
     */
    function setAllowlistEnabled(
        bool _enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowlistEnabled = _enabled;
        emit AllowlistStatusUpdated(_enabled);
    }

    /**
     * @notice Updates allowlist for an address
     * @param account Address to update
     * @param allowed Whether address is allowed
     */
    function setAllowlistAddress(
        address account,
        bool allowed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidAddress();
        allowlist[account] = allowed;
        emit AllowlistAddressUpdated(account, allowed);
    }

    /**
     * @notice Updates Chainlink configuration
     * @param _router New router address
     * @param _donId New DON ID
     * @param _subscriptionId New subscription ID
     * @param _gasLimit New gas limit
     */
    function updateChainlinkConfig(
        address _router,
        bytes32 _donId,
        uint64 _subscriptionId,
        uint32 _gasLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_router == address(0)) revert InvalidAddress();
        if (_gasLimit == 0) revert InvalidConfiguration();

        functionsRouter = _router;
        donId = _donId;
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;

        emit ChainlinkConfigUpdated(_router, _donId, _subscriptionId);
    }

    /**
     * @notice Pauses the contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================
    //                        VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Returns current reserve amount in USD (8 decimals)
     */
    function reserveUsd() external view returns (uint256) {
        return lastReserveUsd;
    }

    /**
     * @notice Returns age of reserve data in seconds
     */
    function reserveAge() external view returns (uint256) {
        if (lastReserveTimestamp == 0) return type(uint256).max;
        return block.timestamp - lastReserveTimestamp;
    }

    /**
     * @notice Returns current reserve nonce
     */
    function reserveNonce() external view returns (uint256) {
        return lastReserveNonce;
    }

    /**
     * @notice Returns whether reserve is fresh
     */
    function isReserveFresh() external view returns (bool) {
        if (lastReserveTimestamp == 0) return false;
        return (block.timestamp - lastReserveTimestamp) <= reserveTTL;
    }

    /**
     * @notice Returns available minting capacity
     */
    function availableMintCapacity() external view returns (uint256) {
        uint256 reserveScaled = lastReserveUsd * RESERVE_TO_TOKEN_SCALE;
        uint256 supply = totalSupply();
        if (reserveScaled <= supply) return 0;
        return reserveScaled - supply;
    }

    // =============================================================
    //                    UPGRADE AUTHORIZATION
    // =============================================================

    /**
     * @notice Authorizes upgrade to new implementation
     * @dev Only callable by admin
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
