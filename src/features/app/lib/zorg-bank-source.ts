// ZorgBank.sol — exact source used to compile the deployed bytecode
// Compiler: solc 0.8.20, optimizer 200 runs, EVM london

export const ZORG_BANK_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * ZorgBank — the central vault for the ZORG protocol.
 *
 * Holds:
 *   - ZORG tokens (deposited by dev wallet after token deploy)
 *   - ETH (received from check-in fees)
 *
 * Access control:
 *   - owner   : dev wallet — full control, can change operator
 *   - operator: Neynar server wallet — can call sendTokens for distributions
 *
 * All ETH sent to this contract is stored for LP provision.
 */
contract ZorgBank {
    address public owner;
    address public operator;

    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event OperatorChanged(address indexed oldOp, address indexed newOp);
    event TokensSent(address indexed token, address indexed to, uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event ETHReceived(address indexed from, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner || msg.sender == operator, "not authorized");
        _;
    }

    constructor(address _owner, address _operator) {
        owner = _owner;
        operator = _operator;
    }

    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }

    function sendTokens(address token, address to, uint256 amount) external onlyAuthorized {
        require(amount > 0, "zero amount");
        bool ok = IERC20(token).transfer(to, amount);
        require(ok, "transfer failed");
        emit TokensSent(token, to, amount);
    }

    function approveToken(address token, address spender, uint256 amount) external onlyOwner {
        IERC20(token).approve(spender, amount);
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        require(amount > 0 && amount <= address(this).balance, "invalid amount");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit ETHWithdrawn(to, amount);
    }

    function withdrawAllETH(address to) external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "no ETH");
        (bool ok,) = to.call{value: bal}("");
        require(ok, "ETH transfer failed");
        emit ETHWithdrawn(to, bal);
    }

    function setOperator(address newOperator) external onlyOwner {
        emit OperatorChanged(operator, newOperator);
        operator = newOperator;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function ethBalance() external view returns (uint256) {
        return address(this).balance;
    }
}`;
