require('dotenv').config();

const Web3 = require('web3');
const fs = require('fs');
const path = require('path');

// Load environment variables
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!RPC_URL || !PRIVATE_KEY) {
  console.error('❌ RPC_URL or PRIVATE_KEY missing in .env');
  process.exit(1);
}

// 1. Setup Web3
const web3 = new Web3(RPC_URL);

// 2. Load deployment info JSON
const deploymentPath = path.resolve(__dirname, 'deployment_info.json');

if (!fs.existsSync(deploymentPath)) {
  console.error('❌ deployment_info.json not found. Run deploy_contracts.js first.');
  process.exit(1);
}

const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

const callerAddress = deploymentInfo.caller.address;
const callerAbi = deploymentInfo.caller.abi;

// 3. Create ContractCaller instance
const callerContract = new web3.eth.Contract(callerAbi, callerAddress);

// 4. 125 Gwei as msg.value
const valueInWei = web3.utils.toWei('125', 'gwei'); // this is the ETH value sent to the function

// Helper: generic JSON-RPC call using the underlying provider
const sendRpc = (method, params = []) => {
  const provider = web3.currentProvider;

  return new Promise((resolve, reject) => {
    // web3.js HTTP provider uses send()
    provider.send(
      {
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      },
      (err, res) => {
        if (err) return reject(err);
        if (res.error) return reject(res.error);
        resolve(res.result);
      }
    );
  });
};

// Inspect internal calls for a given tx hash using RPC
const inspectInternalTransactions = async (txHash) => {
  console.log('\n=== Inspecting internal transactions for tx ===');
  console.log('Tx Hash:', txHash);

  // First try trace_transaction (Parity / OpenEthereum-style)
  try {
    console.log('\nTrying RPC method: trace_transaction');
    const traces = await sendRpc('trace_transaction', [txHash]);

    if (Array.isArray(traces)) {
      console.log(`trace_transaction returned ${traces.length} trace entries.`);

      const internalCalls = traces.filter((t) => t.type === 'call');

      if (internalCalls.length === 0) {
        console.log('No internal "call" traces found.');
      } else {
        console.log(`\nInternal CALL traces (${internalCalls.length}):`);
        internalCalls.forEach((t, idx) => {
          const action = t.action || {};
          console.log(`\n#${idx + 1}`);
          console.log('  From: ', action.from);
          console.log('  To:   ', action.to);
          console.log('  Value:', action.value);
          console.log('  CallType:', action.callType);
          console.log('  Input (first 20 chars):', action.input ? `${action.input.slice(0, 20)}...` : '');
        });
      }
      return; // Done if trace_transaction worked
    } else {
      console.log('trace_transaction result is not an array:', traces);
    }
  } catch (e) {
    console.warn('trace_transaction not available or failed:', e.message || e);
  }

  // Fallback: debug_traceTransaction (Geth / Ganache / Hardhat-style)
  try {
    console.log('\nTrying RPC method: debug_traceTransaction');
    const debugTrace = await sendRpc('debug_traceTransaction', [txHash, {}]);

    // debug_traceTransaction structure is node-dependent; we’ll just log high-level info.
    console.log('debug_traceTransaction result received.');

    // If it has structLogs, we can roughly scan for CALL opcodes
    if (debugTrace && Array.isArray(debugTrace.structLogs)) {
      const callOps = debugTrace.structLogs.filter((log) =>
        ['CALL', 'CALLCODE', 'DELEGATECALL', 'STATICCALL'].includes(log.op)
      );

      console.log(`Found ${callOps.length} EVM CALL-like opcodes in structLogs.`);
      console.log(
        'Note: Extracting exact "from/to/value" from debug_traceTransaction requires EVM stack decoding,\n' +
          'which is more advanced. Here we only confirm that internal call opcodes occurred.'
      );
    } else {
      console.log('debug_traceTransaction result (raw):');
      console.log(JSON.stringify(debugTrace, null, 2).slice(0, 1000) + '...');
    }
  } catch (e) {
    console.warn('debug_traceTransaction not available or failed:', e.message || e);
    console.log(
      '\nCould not retrieve internal transaction traces from this RPC node.\n' +
        'Make sure your node supports trace/debug RPCs (e.g., Ganache, Hardhat, Geth with debug API enabled).'
    );
  }
};

const callReceiver = async () => {
  try {
    const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;

    console.log('\n=== Calling ContractCaller.callReceiverContract() ===');
    console.log('From address:', account.address);
    console.log('ContractCaller address:', callerAddress);
    console.log('Sending value (msg.value):', valueInWei, 'wei (125 Gwei)');

    // Encode the function call
    const txData = callerContract.methods.callReceiverContract().encodeABI();

    // Build transaction
    let tx = {
      from: account.address,
      to: callerAddress,
      data: txData,
      value: valueInWei,
      gas: 300_000,
      gasPrice: await web3.eth.getGasPrice()
    };

    console.log('\nEstimating gas for call...');
    const gasEstimate = await web3.eth
      .estimateGas(tx)
      .catch((err) => {
        console.warn('Gas estimation failed, using default 300,000:', err.message);
        return tx.gas;
      });

    tx.gas = gasEstimate;

    console.log('Transaction payload (shortened):', {
      from: tx.from,
      to: tx.to,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      value: tx.value.toString(),
      data: `${tx.data.substring(0, 20)}...${tx.data.slice(-10)}`
    });

    console.log('\nSigning transaction...');
    const signedTx = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);

    console.log('Sending transaction...');
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    console.log('\n✅ callReceiverContract() Transaction Successful!');
    console.log('Tx Hash:', receipt.transactionHash);
    console.log('Block:', receipt.blockNumber);
    console.log('Gas Used:', receipt.gasUsed);

    // 🔎 NEW: inspect internal transactions via RPC
    await inspectInternalTransactions(receipt.transactionHash);
  } catch (err) {
    console.error('\n❌ Error calling callReceiverContract():');
    console.error(err.message || err);
    if (err.receipt) {
      console.error('Receipt:', err.receipt);
    }
    process.exit(1);
  }
};

callReceiver();

