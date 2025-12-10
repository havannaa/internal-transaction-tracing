require('dotenv').config();

const Web3 = require('web3');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

// === 1. Load environment variables ===
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const NETWORK_NAME = process.env.NETWORK_NAME || 'unknown-network';

if (!RPC_URL) {
  console.error('❌ RPC_URL is not set in .env');
  process.exit(1);
}

if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY is not set in .env');
  process.exit(1);
}

// 2. Connect to the node
const web3 = new Web3(RPC_URL);

// 3. Load contract sources
const contractsDir = path.resolve(__dirname, 'contracts');

const receiverFile = 'ReceiverContract.sol';
const callerFile = 'ContractCaller.sol';

const receiverSource = fs.readFileSync(path.join(contractsDir, receiverFile), 'utf8');
const callerSource = fs.readFileSync(path.join(contractsDir, callerFile), 'utf8');

console.log('\nCompiling contracts...');

const input = {
  language: 'Solidity',
  sources: {
    [receiverFile]: {
      content: receiverSource
    },
    [callerFile]: {
      content: callerSource
    }
  },
  settings: {
    outputSelection: {
      '*': {
        '*': ['*']
      }
    },
    optimizer: {
      enabled: true,
      runs: 200
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

// 4. Handle compiler errors/warnings
if (output.errors && output.errors.length > 0) {
  let hasError = false;
  output.errors.forEach(err => {
    console.error(err.formattedMessage);
    if (err.severity === 'error') {
      hasError = true;
    }
  });
  if (hasError) {
    throw new Error('Compilation failed due to errors above.');
  }
}

// 5. Extract contract artifacts
const receiverCompiled = output.contracts[receiverFile]['ReceiverContract'];
const callerCompiled = output.contracts[callerFile]['ContractCaller'];

if (!receiverCompiled) {
  console.error('ReceiverContract not found in', receiverFile);
  console.error('Available contracts:', Object.keys(output.contracts[receiverFile]));
  process.exit(1);
}

if (!callerCompiled) {
  console.error('ContractCaller not found in', callerFile);
  console.error('Available contracts:', Object.keys(output.contracts[callerFile]));
  process.exit(1);
}

const {
  abi: receiverAbi,
  evm: {
    bytecode: { object: receiverBytecode }
  }
} = receiverCompiled;

const {
  abi: callerAbi,
  evm: {
    bytecode: { object: callerBytecode }
  }
} = callerCompiled;

// === Helper: generic deploy function ===
const deployContract = async (account, nonce, abi, bytecode, constructorArgs = []) => {
  const contract = new web3.eth.Contract(abi);

  const deployTx = contract.deploy({
    data: '0x' + bytecode,
    arguments: constructorArgs
  });

  const encodedABI = deployTx.encodeABI();

  let tx = {
    from: account.address,
    data: encodedABI,
    gas: 5_000_000,
    gasPrice: await web3.eth.getGasPrice(),
    nonce: nonce
  };

  console.log('\nEstimating gas for deployment...');
  const gasEstimate = await web3.eth
    .estimateGas(tx)
    .catch(err => {
      console.warn('Gas estimation failed, using default:', err.message);
      return tx.gas;
    });

  tx.gas = gasEstimate;

  console.log('Deployment transaction payload (shortened):', {
    from: tx.from,
    gas: tx.gas,
    gasPrice: tx.gasPrice,
    nonce: tx.nonce,
    data: `${tx.data.substring(0, 20)}...${tx.data.slice(-10)} (${tx.data.length} chars)`
  });

  console.log('\nSigning & sending deployment transaction...');
  const signedTx = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

  return receipt;
};

// === Main flow: deploy Receiver, then ContractCaller, then write JSON ===
const main = async () => {
  try {
    // 1. Create account from private key
    const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;

    console.log('\n=== Deployment Setup ===');
    console.log('Configured Network (env):', NETWORK_NAME);
    console.log('RPC URL:', RPC_URL);
    console.log('Deployer Address:', account.address);
    console.log(
      'Balance:',
      web3.utils.fromWei(await web3.eth.getBalance(account.address), 'ether'),
      'ETH'
    );
    console.log('Node Network Type (from RPC):', await web3.eth.net.getNetworkType());

    let nonce = await web3.eth.getTransactionCount(account.address, 'pending');
    console.log('Starting nonce:', nonce);

    // 2. Deploy ReceiverContract
    console.log('\n=== Step 1: Deploying ReceiverContract ===');

    const receiverReceipt = await deployContract(
      account,
      nonce,
      receiverAbi,
      receiverBytecode,
      []
    );

    console.log('\n✅ ReceiverContract Deployed!');
    console.log('Address:', receiverReceipt.contractAddress);
    console.log('Tx Hash:', receiverReceipt.transactionHash);
    console.log('Block:', receiverReceipt.blockNumber);
    console.log('Gas Used:', receiverReceipt.gasUsed);

    const receiverAddress = receiverReceipt.contractAddress;
    nonce++;

    // 3. Deploy ContractCaller with constructor parameter (receiverAddress)
    console.log('\n=== Step 2: Deploying ContractCaller ===');
    console.log('Passing ReceiverContract address to constructor:', receiverAddress);

    const callerReceipt = await deployContract(
      account,
      nonce,
      callerAbi,
      callerBytecode,
      [receiverAddress]
    );

    console.log('\n✅ ContractCaller Deployed!');
    console.log('Address:', callerReceipt.contractAddress);
    console.log('Tx Hash:', callerReceipt.transactionHash);
    console.log('Block:', callerReceipt.blockNumber);
    console.log('Gas Used:', callerReceipt.gasUsed);

    // 4. Write deployment info JSON for the call script
    const deploymentInfo = {
      envNetwork: NETWORK_NAME,
      rpcUrl: RPC_URL,
      deployer: account.address,
      receiver: {
        contractName: 'ReceiverContract',
        address: receiverAddress,
        abi: receiverAbi,
        transactionHash: receiverReceipt.transactionHash,
        blockNumber: receiverReceipt.blockNumber
      },
      caller: {
        contractName: 'ContractCaller',
        address: callerReceipt.contractAddress,
        abi: callerAbi,
        transactionHash: callerReceipt.transactionHash,
        blockNumber: callerReceipt.blockNumber
      },
      timestamp: new Date().toISOString()
    };

    const outPath = path.resolve(__dirname, 'deployment_info.json');
    fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));

    console.log('\n📄 deployment_info.json written at:', outPath);

    console.log('\n=== Final Deployment Summary ===');
    console.log('ReceiverContract Address:', receiverAddress);
    console.log('ContractCaller Address:', callerReceipt.contractAddress);
  } catch (error) {
    console.error('\n❌ Deployment Failed:');
    console.error(error.message);
    if (error.receipt) {
      console.error('Receipt:', error.receipt);
    }
    process.exit(1);
  }
};

main();

