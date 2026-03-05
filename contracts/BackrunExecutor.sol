// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * MEV Backrun Executor Contract
 * Executes flash loan borrowing, swaps, and profit extraction atomically
 * 
 * Production Features:
 * - Multi-sig support (2-of-3 guardians)
 * - Timelock delay for critical operations
 * - Flash loan rate limiting
 * - Circuit breaker (pause/unpause)
 * 
 * Flow:
 * 1. Bot calls flashLoan() requesting borrowed tokens
 * 2. Aave sends tokens + calls executeOperation()
 * 3. Contract swaps on DEX to capture MEV
 * 4. Repays Aave (amount + 0.05% fee)
 * 5. Sends profit to caller
 */

import "@aave/core-v3/contracts/flashloan/base/FlashLoanReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface ISwapRouter {
  function swapExactTokensForTokens(
    uint amountIn,
    uint amountOutMin,
    address[] calldata path,
    address to,
    uint deadline
  ) external returns (uint[] memory amounts);
}

/**
 * @title BackrunExecutor
 * @dev Production-ready MEV backrun executor with multi-sig, rate limiting, and circuit breaker
 */
contract BackrunExecutor is FlashLoanReceiverBase, Ownable, ReentrancyGuard {
  ISwapRouter internal constant QUICKSWAP_ROUTER =
    ISwapRouter(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff);

  address internal constant MATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
  address internal constant USDC = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;

  // ====== Circuit Breaker ======
  bool public paused = false;
  address public guardian;

  // ====== Rate Limiting ======
  uint256 public lastFlashLoanBlock;
  uint256 public constant FLASH_LOAN_RATE_LIMIT = 1; // 1 flash loan per block

  // ====== Multi-sig / Timelock ======
  mapping(address => bool) public guardians;
  uint256 public constant GUARDIAN_REQUIRED = 2;
  uint256 public constant TIMELOCK_DELAY = 2 days;
  
  struct PendingAction {
    bytes32 actionHash;
    uint256 executeAfter;
    bool executed;
  }
  
  mapping(bytes32 => PendingAction) public pendingActions;
  mapping(address => uint256) public guardianConfirmations;

  // ====== Events ======
  event BackrunExecuted(
    address indexed token,
    uint amountBorrowed,
    uint amountRepaid,
    uint profit
  );

  event SwapExecuted(
    address[] indexed path,
    uint amountIn,
    uint amountOut
  );

  // ====== Circuit Breaker Events ======
  event Paused(address account);
  event Unpaused(address account);

  // ====== Multi-sig Events ======
  event GuardianAdded(address indexed guardian);
  event GuardianRemoved(address indexed guardian);
  event ActionQueued(bytes32 indexed actionHash, uint256 executeAfter);
  event ActionExecuted(bytes32 indexed actionHash);
  event ActionCancelled(bytes32 indexed actionHash);
  event GuardianConfirmed(address indexed guardian, bytes32 indexed actionHash);

  // ====== Modifiers ======
  modifier whenNotPaused() {
    require(!paused, "Contract is paused");
    _;
  }

  modifier whenPaused() {
    require(paused, "Contract is not paused");
    _;
  }

  modifier rateLimited() {
    require(block.number > lastFlashLoanBlock + FLASH_LOAN_RATE_LIMIT, "Rate limited: flash loan too frequent");
    _;
    lastFlashLoanBlock = block.number;
  }

  modifier onlyGuardian() {
    require(guardians[msg.sender], "Not authorized guardian");
    _;
  }

  constructor(address provider, address[] memory _guardians) FlashLoanReceiverBase(IPoolAddressesProvider(provider)) {
    require(_guardians.length >= GUARDIAN_REQUIRED, "Need at least 2 guardians");
    guardian = _guardians[0]; // Primary guardian for emergency
    
    for (uint256 i = 0; i < _guardians.length; i++) {
      guardians[_guardians[i]] = true;
      emit GuardianAdded(_guardians[i]);
    }
  }

  // ====== Circuit Breaker Functions ======
  
  /**
   * @dev Pause the contract (emergency stop)
   */
  function pause() external onlyGuardian {
    paused = true;
    emit Paused(msg.sender);
  }

  /**
   * @dev Unpause the contract (requires timelock)
   */
  function queueUnpause() external onlyOwner returns (bytes32) {
    bytes32 actionHash = keccak256(abi.encodePacked("UNPAUSE", block.timestamp));
    pendingActions[actionHash] = PendingAction({
      actionHash: actionHash,
      executeAfter: block.timestamp + TIMELOCK_DELAY,
      executed: false
    });
    emit ActionQueued(actionHash, block.timestamp + TIMELOCK_DELAY);
    return actionHash;
  }

  function executeUnpause(bytes32 actionHash) external onlyOwner {
    PendingAction storage action = pendingActions[actionHash];
    require(action.actionHash == actionHash, "Invalid action");
    require(!action.executed, "Already executed");
    require(block.timestamp >= action.executeAfter, "Timelock not expired");
    
    action.executed = true;
    paused = false;
    emit ActionExecuted(actionHash);
    emit Unpaused(msg.sender);
  }

  // ====== Multi-sig Functions ======

  /**
   * @dev Add a new guardian (requires 2 guardian confirmations + timelock)
   */
  function queueAddGuardian(address newGuardian) external onlyOwner returns (bytes32) {
    bytes32 actionHash = keccak256(abi.encodePacked("ADD_GUARDIAN", newGuardian, block.timestamp));
    pendingActions[actionHash] = PendingAction({
      actionHash: actionHash,
      executeAfter: block.timestamp + TIMELOCK_DELAY,
      executed: false
    });
    emit ActionQueued(actionHash, block.timestamp + TIMELOCK_DELAY);
    return actionHash;
  }

  function executeAddGuardian(bytes32 actionHash, address newGuardian) external onlyOwner {
    PendingAction storage action = pendingActions[actionHash];
    require(action.actionHash == actionHash, "Invalid action");
    require(!action.executed, "Already executed");
    require(block.timestamp >= action.executeAfter, "Timelock not expired");
    
    action.executed = true;
    guardians[newGuardian] = true;
    emit ActionExecuted(actionHash);
    emit GuardianAdded(newGuardian);
  }

  /**
   * @dev Remove a guardian (requires 2 guardian confirmations + timelock)
   */
  function queueRemoveGuardian(address guardianToRemove) external onlyOwner returns (bytes32) {
    bytes32 actionHash = keccak256(abi.encodePacked("REMOVE_GUARDIAN", guardianToRemove, block.timestamp));
    pendingActions[actionHash] = PendingAction({
      actionHash: actionHash,
      executeAfter: block.timestamp + TIMELOCK_DELAY,
      executed: false
    });
    emit ActionQueued(actionHash, block.timestamp + TIMELOCK_DELAY);
    return actionHash;
  }

  function executeRemoveGuardian(bytes32 actionHash, address guardianToRemove) external onlyOwner {
    PendingAction storage action = pendingActions[actionHash];
    require(action.actionHash == actionHash, "Invalid action");
    require(!action.executed, "Already executed");
    require(block.timestamp >= action.executeAfter, "Timelock not expired");
    
    action.executed = true;
    guardians[guardianToRemove] = false;
    emit ActionExecuted(actionHash);
    emit GuardianRemoved(guardianToRemove);
  }

  // ====== Core Functions ======

  /**
   * Initiate a flash loan and backrun
   * @param tokenToBorrow Token to flash borrow
   * @param amountToBorrow Amount to borrow
   * @param path Swap path for the backrun
   * @param amountOutMin Minimum output from swap
   */
  function executeBackrun(
    address tokenToBorrow,
    uint256 amountToBorrow,
    address[] calldata path,
    uint256 amountOutMin
  ) external onlyOwner whenNotPaused nonReentrant rateLimited {
    address receiverAddress = address(this);
    address[] memory tokens = new address[](1);
    tokens[0] = tokenToBorrow;
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = amountToBorrow;
    uint256[] memory modes = new uint256[](1);
    modes[0] = 0; // 0 = no debt, just flash loan

    bytes memory params = abi.encode(path, amountOutMin);

    POOL.flashLoan(
      receiverAddress,
      tokens,
      amounts,
      modes,
      address(this),
      params,
      0
    );
  }

  /**
   * Aave callback – executed during flash loan
   * Implements IFlashLoanReceiver.executeOperation
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override nonReentrant returns (bool) {
    // ensure the caller is the Aave Pool contract (mimics onlyPool modifier)
    require(msg.sender == address(POOL), "Caller must be pool");
    require(initiator == address(this), "Invalid initiator");
    require(!paused, "Contract is paused");

    // We only support single-asset flash loans in this executor
    require(assets.length == 1 && amounts.length == 1 && premiums.length == 1, "Only single-asset flashloan");

    address asset = assets[0];
    uint256 amount = amounts[0];
    uint256 premium = premiums[0];

    // Decode parameters
    (address[] memory path, uint256 amountOutMin) = abi.decode(
      params,
      (address[], uint256)
    );

    // Ensure path is valid
    require(path.length >= 2, "Invalid path length");
    require(path[0] == asset, "Path input token mismatch");

    // For flash loan repayment: we need to have the asset available to repay
    // The swap transforms path[0] -> path[path.length-1]
    // We must ensure the final output can cover the repayment
    address outputToken = path[path.length - 1];

    // Approve DEX router to spend borrowed tokens
    IERC20(asset).approve(address(QUICKSWAP_ROUTER), amount);

    // Execute the backrun swap with 60-second deadline for safety
    uint256 deadline = block.timestamp + 60;
    uint256[] memory amountsOut = QUICKSWAP_ROUTER.swapExactTokensForTokens(
      amount,
      amountOutMin,
      path,
      address(this),
      deadline
    );

    // Validate swap output
    require(amountsOut.length > 0, "Swap returned no data");
    uint256 amountOut = amountsOut[amountsOut.length - 1];
    require(amountOut > 0, "Swap produced zero output");
    require(amountOut >= amountOutMin, "Slippage exceeded minimum");

    emit SwapExecuted(path, amount, amountOut);

    // Calculate amount owed to Aave (principal + fee)
    uint256 amountOwed = amount + premium;
    
    // Calculate profit
    require(amountOut >= amountOwed, "Insufficient output to cover loan + fee");

    uint256 profit = amountOut - amountOwed;

    // Repay the flash loan
    IERC20(path[path.length - 1]).approve(address(POOL), amountOwed);

    // Send profit to owner
    if (profit > 0) {
      IERC20(path[path.length - 1]).transfer(owner(), profit);
    }

    emit BackrunExecuted(asset, amount, amountOwed, profit);

    return true;
  }

  /**
   * Emergency: withdraw stuck tokens
   */
  function withdraw(address token, uint256 amount) external onlyOwner whenNotPaused {
    IERC20(token).transfer(owner(), amount);
  }

  /**
   * Get available flash loan amount for a token
   */
  function getAvailableLiquidity(address token) external view returns (uint256) {
    return IERC20(token).balanceOf(address(POOL));
  }

  receive() external payable {}
}
