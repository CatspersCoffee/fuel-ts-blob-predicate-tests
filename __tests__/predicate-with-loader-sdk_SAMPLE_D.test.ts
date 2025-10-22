import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  WalletUnlocked,
  bn,
  ScriptTransactionRequest,
  Provider,
  BN,
} from 'fuels';
import { launchTestNode } from 'fuels/test-utils';
import { Wallet } from 'ethers';
import { toCompactSignature } from '../src/utils/signatureUtils.js';
import { Simple } from '../src/generated/predicates/Simple.js';
import { SimpleLoader } from '../src/generated/predicates/SimpleLoader.js';
import { 
  calculateBlobId, 
  verifyLoaderBlobId,
  parseLoaderStructure,
  bytesToHex 
} from '../src/utils/blobUtils.js';
import { deployPredicateBlob } from '../src/utils/blobDeployment.js';

/**
 * FIXED: Blob-Based Predicate Test with Proper Gas Estimation
 * 
 * This test demonstrates the corrected approach for gas estimation
 * when using blob-deployed predicates with loaders.
 */
describe('Simple Predicate with Blob Loader - FIXED', () => {
  let provider: Provider;
  let cleanup: () => void;
  let fundingWallet: WalletUnlocked;
  let evmWallet: Wallet;
  let blobPredicate: SimpleLoader;
  let blobId: string;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('BLOB-BASED PREDICATE TEST SETUP (FIXED VERSION)');
    console.log('='.repeat(80));

    // Launch test node with SDK
    const launched = await launchTestNode({
      walletsConfig: {
        count: 1,
        amountPerCoin: 10_000_000,
      },
    });

    provider = launched.provider;
    cleanup = launched.cleanup;
    fundingWallet = launched.wallets[0];

    console.log('✅ Test node launched');
    console.log('Provider URL:', provider.url);
    console.log('Funding Wallet Address:', fundingWallet.address.toString());

    const baseAssetId = await provider.getBaseAssetId();
    const balance = await fundingWallet.getBalance(baseAssetId);
    console.log('Funding Wallet Balance:', balance.toString(), 'units');

    // Create EVM wallet
    const evmPrivateKey = process.env.TEST_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
    evmWallet = new Wallet(evmPrivateKey);
    console.log('EVM Address:', evmWallet.address);

    // STEP 1: Calculate and verify BlobID
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 1: BlobID Calculation and Verification');
    console.log('-'.repeat(80));
    
    blobId = calculateBlobId(Simple.bytecode, Simple.abi);
    console.log('Calculated BlobID:', blobId);
    console.log('Full predicate size:', Simple.bytecode.length, 'bytes');
    console.log('Blob-Predicate (loader) size:', SimpleLoader.bytecode.length, 'bytes');
    
    const sizeReduction = ((1 - SimpleLoader.bytecode.length / Simple.bytecode.length) * 100).toFixed(1);
    console.log(`Size reduction: ${sizeReduction}%`);
    
    const isLoaderValid = verifyLoaderBlobId(Simple.bytecode, Simple.abi, SimpleLoader.bytecode);
    console.log('Blob-Predicate verification:', isLoaderValid ? '✅ Valid' : '❌ Invalid');
    expect(isLoaderValid).toBe(true);

    // STEP 2: Deploy blob
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 2: Blob Deployment');
    console.log('-'.repeat(80));
    
    const cleanAddress = evmWallet.address.toLowerCase().replace('0x', '');
    const paddedAddress = cleanAddress.padStart(64, '0');
    
    const simplePredicate = new Simple({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    console.log('Deploying full predicate bytecode as blob...');
    const deployResult = await deployPredicateBlob(simplePredicate, fundingWallet);
    console.log('Deployment result:', deployResult.status);
    console.log('Deployed BlobID:', deployResult.blobId);
    
    expect(deployResult.blobId).toBe(blobId);

    // STEP 3: Create blob-predicate (loader) instance
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 3: Blob-Predicate Initialization');
    console.log('-'.repeat(80));
    
    blobPredicate = new SimpleLoader({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    console.log('Blob-Predicate Address:', blobPredicate.address.toString());
    console.log('This loader references blob:', blobId);

    // STEP 4: Fund the blob-predicate address
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 4: Funding Blob-Predicate Address');
    console.log('-'.repeat(80));
    
    const tx = await fundingWallet.transfer(
      blobPredicate.address,
      bn(1000000),
      baseAssetId
    );
    await tx.waitForResult();
    
    const blobPredicateBalance = await provider.getBalance(blobPredicate.address, baseAssetId);
    console.log('✅ Blob-Predicate funded with 1000000 units');
    console.log('Blob-Predicate balance:', blobPredicateBalance.toString(), 'units');
    console.log('='.repeat(80) + '\n');
  });

  afterAll(() => {
    if (cleanup) {
      cleanup();
      console.log('\n✅ Test node cleaned up\n');
    }
  });

  it('should successfully spend from blob-predicate with FIXED gas estimation', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('TRANSACTION EXECUTION TEST (FIXED)');
    console.log('='.repeat(80));
    
    const recipient = WalletUnlocked.generate({ provider });
    const amountToSend = bn(1234);

    console.log('\n📋 Transaction Details:');
    console.log('  Recipient:', recipient.address.toString());
    console.log('  Amount to send:', amountToSend.toString(), 'units');
    console.log('  Blob-Predicate Address:', blobPredicate.address.toString());

    // BUILD TRANSACTION
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 1: Build Transaction Request');
    console.log('-'.repeat(80));
    
    // FIX 1: Set proper initial gas values
    const request = new ScriptTransactionRequest({
      gasLimit: bn(200000),     // Higher initial limit
      maxFeePerGas: bn(1),       // Set explicitly
    });
    
    console.log('Initial gas settings:');
    console.log('  gasLimit:', request.gasLimit?.toString());
    console.log('  maxFeePerGas:', request.maxFeePerGas?.toString());

    // ADD BLOB-PREDICATE INPUTS
    console.log('\n📦 Getting resources from Blob-Predicate...');
    const resources = await blobPredicate.getResourcesToSpend([
      {
        amount: amountToSend,
        assetId: await provider.getBaseAssetId(),
      },
    ]);
    console.log('  Found', resources.length, 'spendable resource(s)');

    request.addResources(resources);
    request.addCoinOutput(recipient.address, amountToSend, await provider.getBaseAssetId());
    request.addChangeOutput(blobPredicate.address, await provider.getBaseAssetId());
    
    console.log('  Inputs added:', request.inputs.length);
    console.log('  Outputs added:', request.outputs.length);

    // ADD PLACEHOLDER WITNESS
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 2: Add Placeholder Witness');
    console.log('-'.repeat(80));
    
    const placeholderWitness = new Uint8Array(64).fill(0);
    const witnessIndex = request.witnesses.length;
    request.witnesses.push(placeholderWitness);
    console.log('  Placeholder witness added at index:', witnessIndex);

    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });
    console.log('  Witness index set on predicate inputs');

    // CALCULATE TRANSACTION ID
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 3: Calculate Transaction ID');
    console.log('-'.repeat(80));
    
    const chainId = await provider.getChainId();
    const txId = request.getTransactionId(chainId);
    console.log('  Chain ID:', chainId);
    console.log('  Transaction ID:', txId);

    // SIGN WITH EVM WALLET
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 4: Sign Transaction ID with EVM Wallet');
    console.log('-'.repeat(80));
    
    const txIdString = txId.slice(2);
    console.log('  Signing message:', txIdString);
    const signature = await evmWallet.signMessage(txIdString);
    console.log('  EVM Signature (65 bytes):', signature);

    const compactSig = toCompactSignature(signature);
    console.log('  Compact Signature (64 bytes):', compactSig);

    const compactBytes = new Uint8Array(
      compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    // Replace placeholder with real signature
    request.witnesses[witnessIndex] = compactBytes;
    console.log('  ✅ Real signature installed');

    // FIX 2: Store original gas values BEFORE estimation
    const originalMaxFee = request.maxFeePerGas || bn(1);
    const originalGasLimit = request.gasLimit || bn(200000);

    // ESTIMATE PREDICATES
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 5: Estimate Predicates (FIXED)');
    console.log('-'.repeat(80));
    console.log('  Calling provider.estimatePredicates()...');
    
    const estimated = await provider.estimatePredicates(request);
    
    console.log('\n  ✅ Estimation complete!');
    console.log('  Raw estimation results:');
    console.log('    gasLimit:', estimated.gasLimit?.toString());
    console.log('    maxFeePerGas:', estimated.maxFeePerGas?.toString());
    console.log('    witnessLimit:', estimated.witnessLimit?.toString());
    console.log('    predicateGasUsed:', estimated.inputs[0].predicateGasUsed?.toString());
    
    // FIX 3: Properly restore and set gas parameters
    console.log('\n  🔧 Applying gas parameter fixes...');
    
    // Critical: Ensure maxFeePerGas is set and not zero
    if (!estimated.maxFeePerGas || estimated.maxFeePerGas.eq(0)) {
      estimated.maxFeePerGas = BN.max(originalMaxFee, bn(1));
      console.log('  ✅ Fixed maxFeePerGas to:', estimated.maxFeePerGas.toString());
    }
    
    // FIX 3: Set the correct property - maxFee instead of maxFeePerGas
    console.log('\n  🔧 Applying gas parameter fixes...');

    // The SDK uses maxFee (total fee), not maxFeePerGas
    const gasLimit = estimated.gasLimit || bn(200000);
    const gasPrice = bn(1);
    const maxFee = gasLimit.mul(gasPrice).mul(2); // 2x buffer for safety

    // Set the actual property the SDK uses
    (estimated as any).maxFee = maxFee;
    (estimated as any).gasPrice = gasPrice;

    console.log('  ✅ Set maxFee to:', maxFee.toString());
    console.log('  ✅ Set gasPrice to:', gasPrice.toString());
    console.log('  ✅ gasLimit:', gasLimit.toString());

    // Set witness limit if missing
    if (!estimated.witnessLimit) {
      estimated.witnessLimit = bn(10000);
      console.log('  ✅ Set witnessLimit to:', estimated.witnessLimit.toString());
    }

    console.log('\n  📊 Final gas parameters:');
    console.log('    gasLimit:', estimated.gasLimit?.toString());
    console.log('    maxFee:', (estimated as any).maxFee?.toString());
    console.log('    gasPrice:', (estimated as any).gasPrice?.toString());
    console.log('    witnessLimit:', estimated.witnessLimit?.toString());

    // FIX 4: Validate before sending
    if (!estimated.maxFeePerGas || estimated.maxFeePerGas.eq(0)) {
      throw new Error('CRITICAL: maxFeePerGas is still 0 - transaction will fail!');
    }

    // SEND TRANSACTION
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 6: Send Transaction');
    console.log('-'.repeat(80));
    console.log('  Sending transaction to network...');
    
    try {
      const { waitForResult } = await provider.sendTransaction(estimated, {
        estimateTxDependencies: false,
      });
      
      console.log('  Transaction submitted, waiting for result...');
      const result = await waitForResult();

      console.log('\n' + '='.repeat(80));
      console.log('✅ TRANSACTION SUCCESSFUL!');
      console.log('='.repeat(80));
      console.log('Transaction ID:', result.id);
      console.log('Status:', result.status);
      console.log('Block ID:', result.blockId);
      console.log('Gas used:', result.gasUsed?.toString());
      
      console.log('\n📊 Summary:');
      console.log('  • Fixed gas estimation issues');
      console.log('  • Successfully used blob-based predicate');
      console.log('  • Transaction validated and executed');
      console.log('='.repeat(80) + '\n');

      expect(result.status).toBe('success');
    } catch (error: any) {
      console.log('\n' + '='.repeat(80));
      console.log('❌ TRANSACTION FAILED');
      console.log('='.repeat(80));
      console.log('Error type:', error.constructor.name);
      console.log('Error message:', error.message);
      
      // Additional debugging
      console.log('\n🔍 Debug - Final transaction state:');
      console.log('  maxFeePerGas:', estimated.maxFeePerGas?.toString());
      console.log('  gasLimit:', estimated.gasLimit?.toString());
      console.log('  witnessLimit:', estimated.witnessLimit?.toString());
      
      console.log('='.repeat(80) + '\n');
      throw error;
    }
  });
});

/*

 RERUN  __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts x1 
        Filename pattern: predicate-with-loader-sdk_SAMPLE_D.test.ts

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED

================================================================================
BLOB-BASED PREDICATE TEST SETUP (FIXED VERSION)
================================================================================

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED
✅ Test node launched
Provider URL: http://0.0.0.0:40187/v1/graphql
Funding Wallet Address: 0xA860572B5C3af42CFFd670e51abC4Fb165f4875C14ab748384d88f6F007dE1b9

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED
Funding Wallet Balance: 10000000 units
EVM Address: 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf

--------------------------------------------------------------------------------
STEP 1: BlobID Calculation and Verification
--------------------------------------------------------------------------------
Calculated BlobID: 0x36b640cb31b175c92357a7ce67b0a899684503377bb25c97e4870e9409527546
Full predicate size: 4112 bytes
Blob-Predicate (loader) size: 120 bytes
Size reduction: 97.1%
Blob-Predicate verification: ✅ Valid

--------------------------------------------------------------------------------
STEP 2: Blob Deployment
--------------------------------------------------------------------------------
Deploying full predicate bytecode as blob...
Deploying predicate blob...
  BlobID: 0x36b640cb31b175c92357a7ce67b0a899684503377bb25c97e4870e9409527546
  Bytecode size: 4112 bytes
  Deploying wallet address: 0xA860572B5C3af42CFFd670e51abC4Fb165f4875C14ab748384d88f6F007dE1b9

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED
  Deploying wallet balance: 10000000 units
  Predicate type: Simple
  Is this 'Simple' (full predicate)? ✅ Yes

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED
✅ Blob deployed successfully
  Transaction ID: undefined

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED
Deployment result: success
Deployed BlobID: 0x36b640cb31b175c92357a7ce67b0a899684503377bb25c97e4870e9409527546

--------------------------------------------------------------------------------
STEP 3: Blob-Predicate Initialization
--------------------------------------------------------------------------------
Blob-Predicate Address: 0x79A5294B0EF6e7e986603278C83eD443cd5Bf1d3391D3D37D333E34aAc4fc1e0
This loader references blob: 0x36b640cb31b175c92357a7ce67b0a899684503377bb25c97e4870e9409527546

--------------------------------------------------------------------------------
STEP 4: Funding Blob-Predicate Address
--------------------------------------------------------------------------------

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED
✅ Blob-Predicate funded with 1000000 units
Blob-Predicate balance: 1000000 units
================================================================================


stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation

================================================================================
TRANSACTION EXECUTION TEST (FIXED)
================================================================================

📋 Transaction Details:
  Recipient: 0xaBCE68f2F3e67435d3c60c022e9f15b5f80E8E97877700f7FF306c44934Ab986
  Amount to send: 1234 units
  Blob-Predicate Address: 0x79A5294B0EF6e7e986603278C83eD443cd5Bf1d3391D3D37D333E34aAc4fc1e0

--------------------------------------------------------------------------------
STEP 1: Build Transaction Request
--------------------------------------------------------------------------------
Initial gas settings:
  gasLimit: 200000
  maxFeePerGas: undefined

📦 Getting resources from Blob-Predicate...

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation
  Found 1 spendable resource(s)

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation
  Inputs added: 1
  Outputs added: 2

--------------------------------------------------------------------------------
STEP 2: Add Placeholder Witness
--------------------------------------------------------------------------------
  Placeholder witness added at index: 0
  Witness index set on predicate inputs

--------------------------------------------------------------------------------
STEP 3: Calculate Transaction ID
--------------------------------------------------------------------------------

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation
  Chain ID: 0
  Transaction ID: 0x0664cd5be6432c4b2c7a243d81652940d675b51de2b8b1b0efa0b4af298d2c4d

--------------------------------------------------------------------------------
STEP 4: Sign Transaction ID with EVM Wallet
--------------------------------------------------------------------------------
  Signing message: 0664cd5be6432c4b2c7a243d81652940d675b51de2b8b1b0efa0b4af298d2c4d

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation
  EVM Signature (65 bytes): 0x4b9127dc8ebdedb081a8954fa2304141c62e300eb2f37ca44f64e04c38db96b8772246b96dbc165bc61f2c9b267ff09e9064d39ff7e3e8696e22400202b8d7ec1c
  Compact Signature (64 bytes): 0x4b9127dc8ebdedb081a8954fa2304141c62e300eb2f37ca44f64e04c38db96b8f72246b96dbc165bc61f2c9b267ff09e9064d39ff7e3e8696e22400202b8d7ec
  ✅ Real signature installed

--------------------------------------------------------------------------------
STEP 5: Estimate Predicates (FIXED)
--------------------------------------------------------------------------------
  Calling provider.estimatePredicates()...

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation

  ✅ Estimation complete!
  Raw estimation results:
    gasLimit: 200000
    maxFeePerGas: undefined
    witnessLimit: undefined
    predicateGasUsed: 21181

  🔧 Applying gas parameter fixes...
  ✅ Fixed maxFeePerGas to: 1

  🔧 Applying gas parameter fixes...
  ✅ Set maxFee to: 400000
  ✅ Set gasPrice to: 1
  ✅ gasLimit: 200000
  ✅ Set witnessLimit to: 10000

  📊 Final gas parameters:
    gasLimit: 200000
    maxFee: 400000
    gasPrice: 1
    witnessLimit: 10000

--------------------------------------------------------------------------------
STEP 6: Send Transaction
--------------------------------------------------------------------------------
  Sending transaction to network...

stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation

================================================================================
❌ TRANSACTION FAILED
================================================================================
Error type: FuelError
Error message: Invalid transaction data: PredicateVerificationFailed(Panic(PredicateReturnedNonOne))

🔍 Debug - Final transaction state:
  maxFeePerGas: 1
  gasLimit: 200000
  witnessLimit: 10000
================================================================================


stdout | __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts > Simple Predicate with Blob Loader - FIXED

✅ Test node cleaned up


 ❯ __tests__/predicate-with-loader-sdk_SAMPLE_D.test.ts (1 test | 1 failed) 344ms
   × Simple Predicate with Blob Loader - FIXED > should successfully spend from blob-predicate with FIXED gas estimation 85ms
     → Invalid transaction data: PredicateVerificationFailed(Panic(PredicateReturnedNonOne))


*/