// ReceiverContract.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ReceiverContract {
    address public owner;
    uint256 public totalReceived;
    mapping(address => uint256) public balances;
    
    event FundsReceived(address indexed from, uint256 amount);
    event InternalTransferExecuted(address indexed from, address indexed to, uint256 amount);
    event BalanceUpdated(address indexed account, uint256 newBalance);
    
    constructor() {
        owner = msg.sender;
    }
    
    function receiveFunds() external payable {
        require(msg.value > 0, "No funds sent");
        balances[msg.sender] += msg.value;
        totalReceived += msg.value;
        emit FundsReceived(msg.sender, msg.value);
        emit BalanceUpdated(msg.sender, balances[msg.sender]);
    }
    
    function transferTo(address payable recipient, uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        balances[recipient] += amount;
        
        (bool success, ) = recipient.call{value: 0}("");
        require(success, "Transfer failed");
        
        emit InternalTransferExecuted(msg.sender, recipient, amount);
        emit BalanceUpdated(msg.sender, balances[msg.sender]);
        emit BalanceUpdated(recipient, balances[recipient]);
    }
    
    function transferWithValue(address payable recipient, uint256 amount) external payable {
        require(address(this).balance >= amount, "Contract has insufficient balance");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH transfer failed");
        emit InternalTransferExecuted(address(this), recipient, amount);
    }
    
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    function getUserBalance(address user) external view returns (uint256) {
        return balances[user];
    }
    
    receive() external payable {
        balances[msg.sender] += msg.value;
        totalReceived += msg.value;
        emit FundsReceived(msg.sender, msg.value);
        emit BalanceUpdated(msg.sender, balances[msg.sender]);
    }
    
    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "Only owner can withdraw");
        payable(owner).transfer(amount);
    }
}

