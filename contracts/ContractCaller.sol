// ContractCaller.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IReceiver {
    function receiveFunds() external payable;
    function transferTo(address payable recipient, uint256 amount) external;
    function getBalance() external view returns (uint256);
}

contract ContractCaller {
    address public receiverContract;
    uint256 public totalTransfers;
    
    event ContractCallMade(address indexed from, address indexed to, uint256 value);
    event InternalTransfer(address indexed from, address indexed to, uint256 amount);
    
    constructor(address _receiverAddress) {
        receiverContract = _receiverAddress;
    }
    
    function callReceiverContract() external payable {
        require(msg.value > 0, "Must send some ETH");
        IReceiver(receiverContract).receiveFunds{value: msg.value}();
        totalTransfers++;
        emit ContractCallMade(msg.sender, receiverContract, msg.value);
    }
    
    function triggerInternalTransfer(address payable recipient, uint256 amount) external {
        IReceiver(receiverContract).transferTo(recipient, amount);
        emit InternalTransfer(receiverContract, recipient, amount);
    }
    
    function getReceiverBalance() external view returns (uint256) {
        return IReceiver(receiverContract).getBalance();
    }
    
    receive() external payable {}
}

