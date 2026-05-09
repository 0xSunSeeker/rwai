// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IMerchantMoeRouter.sol";
import "./interfaces/IReputationRegistry.sol";

/// @title RWAIVault
/// @notice Execution layer for the RWAI agent. Agent-gated swaps between USDY,
///         mETH, and cmETH via Merchant Moe on Mantle. Every swap is logged
///         on-chain via the ERC-8004 Reputation Registry.
contract RWAIVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── CONSTANTS ────────────────────────────────────────────────────────────

    /// @notice Default per-user cap: $500 in USDY terms (18 decimals).
    /// @dev Assumes USDY has 18 decimals. If USDY uses 6 decimals on Mantle,
    ///      update this to 500e6 before deploying.
    uint256 public constant DEFAULT_CAP = 500e18;

    address public constant USDY  = 0x5BE26527E817998173a93d9e59a6A78B0fFbf32c;
    address public constant METH  = 0xcDA86A272531e8640cD7F1a92c01839911B90bb0;
    address public constant CMETH = 0xE6829d9a7eE3040e1276Fa75293Bde931859e8fA;

    // ─── STATE ────────────────────────────────────────────────────────────────

    IMerchantMoeRouter public immutable router;
    IReputationRegistry public immutable reputationRegistry;

    address public agentAddress;

    /// @notice Per-user swap cap in tokenIn units. 0 means DEFAULT_CAP applies.
    mapping(address => uint256) public userCaps;

    address[] private _supportedTokens;
    mapping(address => bool) public isSupported;

    // ─── EVENTS ───────────────────────────────────────────────────────────────

    event SwapExecuted(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 timestamp,
        bytes32 reasonHash
    );
    event CapUpdated(address indexed user, uint256 newCap);
    event AgentUpdated(address newAgent);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    // Paused(address account) and Unpaused(address account) are emitted by
    // OpenZeppelin Pausable via _pause() / _unpause().

    // ─── MODIFIERS ────────────────────────────────────────────────────────────

    modifier onlyAgent() {
        require(msg.sender == agentAddress, "RWAIVault: not agent");
        _;
    }

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────────

    /// @param _router          MoeRouter address (0xeaEE7EE68874218c3558b40063c42B82D3E7232a)
    /// @param _reputationRegistry ERC-8004 registry (0x8004BAa17C55a88189AE136b182e5fdA19dE9b63)
    /// @param _agentAddress    Initial RWAI agent wallet allowed to trigger swaps
    constructor(
        address _router,
        address _reputationRegistry,
        address _agentAddress
    ) Ownable(msg.sender) {
        require(_router != address(0), "RWAIVault: zero router");
        require(_reputationRegistry != address(0), "RWAIVault: zero registry");
        require(_agentAddress != address(0), "RWAIVault: zero agent");

        router = IMerchantMoeRouter(_router);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        agentAddress = _agentAddress;

        _addToken(USDY);
        _addToken(METH);
        _addToken(CMETH);
    }

    // ─── CORE SWAP ────────────────────────────────────────────────────────────

    /// @notice Execute a swap on behalf of a user via Merchant Moe.
    ///         Only the designated agent can call this. User must have approved
    ///         this contract for at least `amountIn` of `tokenIn` beforehand.
    /// @param user         Wallet whose tokens are being swapped (and who receives output)
    /// @param tokenIn      Token the user is swapping out of
    /// @param tokenOut     Token the user is swapping into
    /// @param amountIn     Exact amount of tokenIn to swap
    /// @param minAmountOut Minimum output enforced by the router (slippage guard)
    /// @param reasonHash   keccak256 of the Claude-generated reasoning for this swap
    /// @return amountOut   Actual amount of tokenOut received by the user
    function executeSwap(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 reasonHash
    ) external nonReentrant whenNotPaused onlyAgent returns (uint256 amountOut) {
        require(user != address(0), "RWAIVault: zero user");
        require(tokenIn != tokenOut, "RWAIVault: same token");
        require(amountIn > 0, "RWAIVault: zero amount");
        require(isSupported[tokenIn], "RWAIVault: tokenIn unsupported");
        require(isSupported[tokenOut], "RWAIVault: tokenOut unsupported");

        uint256 cap = userCaps[user] == 0 ? DEFAULT_CAP : userCaps[user];
        require(amountIn <= cap, "RWAIVault: exceeds cap");

        // Pull tokens from user → vault
        IERC20(tokenIn).safeTransferFrom(user, address(this), amountIn);

        // Approve router for exactly amountIn (forceApprove handles USDT-style tokens)
        IERC20(tokenIn).forceApprove(address(router), amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Swap — output goes directly to user, vault balance returns to zero
        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            user,
            block.timestamp + 5 minutes
        );
        amountOut = amounts[amounts.length - 1];

        // Clear any residual allowance
        IERC20(tokenIn).forceApprove(address(router), 0);

        emit SwapExecuted(user, tokenIn, tokenOut, amountIn, amountOut, block.timestamp, reasonHash);

        // Log to ERC-8004 — wrapped so a registry failure never reverts a valid swap
        _logReputation(amountIn, reasonHash);
    }

    /// @dev Encodes amountIn as a 2-decimal score for the reputation registry.
    ///      For 18-decimal tokens: amountIn / 1e16 = value in cents.
    ///      Max possible value at DEFAULT_CAP (500e18): 50000 — well within int128.
    function _logReputation(uint256 amountIn, bytes32 reasonHash) internal {
        try reputationRegistry.giveFeedback(
            1,
            int128(int256(amountIn / 1e16)),
            2,
            "swap-execution",
            "rwa",
            "rwai-vault",
            "https://rwai.fyi",
            reasonHash
        ) {} catch {}
    }

    // ─── USER CAP ─────────────────────────────────────────────────────────────

    /// @notice Set a custom cap for a user. Cap must be ≤ DEFAULT_CAP ($500).
    ///         A user can lower their own cap; owner and agent can set any user's cap.
    function setUserCap(address user, uint256 cap) external {
        require(
            msg.sender == user || msg.sender == owner() || msg.sender == agentAddress,
            "RWAIVault: unauthorized"
        );
        require(cap > 0, "RWAIVault: zero cap");
        require(cap <= DEFAULT_CAP, "RWAIVault: exceeds max");
        userCaps[user] = cap;
        emit CapUpdated(user, cap);
    }

    // ─── TOKEN REGISTRY ───────────────────────────────────────────────────────

    /// @notice Add a new RWA token to the supported set. Owner only.
    function addSupportedToken(address token) external onlyOwner {
        _addToken(token);
    }

    /// @notice Remove a token from the supported set. Owner only.
    ///         Removes via swap-and-pop so the array stays compact.
    function removeSupportedToken(address token) external onlyOwner {
        require(isSupported[token], "RWAIVault: not supported");
        isSupported[token] = false;
        uint256 len = _supportedTokens.length;
        for (uint256 i = 0; i < len; i++) {
            if (_supportedTokens[i] == token) {
                _supportedTokens[i] = _supportedTokens[len - 1];
                _supportedTokens.pop();
                break;
            }
        }
        emit TokenRemoved(token);
    }

    /// @notice Returns the full list of supported token addresses.
    function getSupportedTokens() external view returns (address[] memory) {
        return _supportedTokens;
    }

    function _addToken(address token) internal {
        require(token != address(0), "RWAIVault: zero address");
        require(!isSupported[token], "RWAIVault: already added");
        isSupported[token] = true;
        _supportedTokens.push(token);
        emit TokenAdded(token);
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

    /// @notice Replace the agent wallet. Owner only.
    function setAgentAddress(address newAgent) external onlyOwner {
        require(newAgent != address(0), "RWAIVault: zero agent");
        agentAddress = newAgent;
        emit AgentUpdated(newAgent);
    }

    /// @notice Emergency stop — disables executeSwap. Owner only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume after emergency stop. Owner only.
    function unpause() external onlyOwner {
        _unpause();
    }
}
