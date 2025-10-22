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


    console.log('\n📋 Complete Transaction Object:');
    console.log(JSON.stringify(estimated, null, 2));

    // After setting gas parameters, add this check:
    console.log('\n⚠️  Checking if transaction ID changed after gas fixes...');
    const newTxId = estimated.getTransactionId(chainId);
    console.log('  Original TX ID:', txId);
    console.log('  New TX ID:     ', newTxId);


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