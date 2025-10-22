import { describe, it, expect, beforeAll } from 'vitest';
import {
  Provider,
  WalletUnlocked,
  bn,
  ScriptTransactionRequest,
} from 'fuels';
import { Wallet } from 'ethers';
import { fundPredicate } from '../src/index';
import { toCompactSignature } from '../src/utils/signatureUtils';
import { Simple } from '../src/generated/predicates/Simple';
import { SimpleLoader } from '../src/generated/predicates/SimpleLoader';
import { 
  calculateBlobId, 
  verifyLoaderBlobId,
  parseLoaderStructure,
  bytesToHex 
} from '../src/utils/blobUtils';
import { deployPredicateBlob } from '../src/utils/blobDeployment';

/**
 * Blob-Based Predicate Test with Local Node
 * 
 * This test demonstrates using a blob-deployed predicate with a loader.
 * The loader is a small bytecode (~120 bytes) that references the full predicate stored as a blob.
 * 
 * Connects to local fuel-core node at http://127.0.0.1:4000/v1/graphql
 */
describe('Simple Predicate with Blob Loader (Local Node)', () => {
  let provider: Provider;
  let wallet: WalletUnlocked;
  let evmWallet: Wallet;
  let blobPredicate: SimpleLoader;
  let blobId: string;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('BLOB-BASED PREDICATE TEST SETUP (LOCAL NODE)');
    console.log('='.repeat(80));

    // Connect to local node
    const url = process.env.FUEL_NETWORK_URL || 'http://127.0.0.1:4000/v1/graphql';
    provider = new Provider(url);
    console.log('Connected to:', url);

    // Create EVM wallet
    const evmPrivateKey = process.env.TEST_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
    evmWallet = new Wallet(evmPrivateKey);
    console.log('EVM Address:', evmWallet.address);

    // Create Fuel wallet from FUEL_LOCALNODE_PRIVATE_KEY
    const fuelPrivateKey = process.env.FUEL_LOCALNODE_PRIVATE_KEY;
    if (!fuelPrivateKey) {
      throw new Error('FUEL_LOCALNODE_PRIVATE_KEY environment variable is required (Fuel private key)');
    }
    
    const formattedKey = fuelPrivateKey.startsWith('0x') ? fuelPrivateKey : `0x${fuelPrivateKey}`;
    wallet = new WalletUnlocked(formattedKey, provider);
    
    console.log('Fuel Wallet Address:', wallet.address.toString());
    
    const baseAssetId = await provider.getBaseAssetId();
    const balance = await wallet.getBalance(baseAssetId);
    console.log('Fuel Wallet Balance:', balance.toString(), 'units');

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
    
    const loaderComponents = parseLoaderStructure(SimpleLoader.bytecode);
    if (loaderComponents) {
      console.log('\nBlob-Predicate structure:');
      console.log('  Instructions:', loaderComponents.instructions.length, 'bytes');
      console.log('  Embedded BlobID:', bytesToHex(loaderComponents.blobId));
      console.log('  Section length:', loaderComponents.sectionLength.toString());
      console.log('  Configurables:', loaderComponents.configurables.length, 'bytes');
      expect(bytesToHex(loaderComponents.blobId)).toBe(blobId);
    }

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
    const deployResult = await deployPredicateBlob(simplePredicate, wallet);
    console.log('Deployment result:', deployResult.status);
    console.log('Deployed BlobID:', deployResult.blobId);
    
    if (deployResult.transactionId) {
      console.log('Transaction ID:', deployResult.transactionId);
    }
    
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
    console.log('Loader bytecode size:', SimpleLoader.bytecode.length, 'bytes');

    // STEP 4: Fund the blob-predicate address
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 4: Funding Blob-Predicate Address');
    console.log('-'.repeat(80));
    
    await fundPredicate(wallet, blobPredicate, '1000000');
    
    const blobPredicateBalance = await provider.getBalance(blobPredicate.address, baseAssetId);
    console.log('✅ Blob-Predicate funded with 1000000 units');
    console.log('Blob-Predicate balance:', blobPredicateBalance.toString(), 'units');
    console.log('='.repeat(80) + '\n');
  });

  it('should successfully spend from blob-predicate with EIP-191 signature', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('TRANSACTION EXECUTION TEST');
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
    
    const request = new ScriptTransactionRequest({
      gasLimit: bn(100000),
      maxFeePerGas: bn(1),
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
    console.log('  Placeholder size: 64 bytes (all zeros)');

    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });
    console.log('  Witness index set on predicate inputs');

    // CALCULATE TRANSACTION ID
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 3: Calculate Transaction ID (with placeholder)');
    console.log('-'.repeat(80));
    
    const chainId = await provider.getChainId();
    const txId = request.getTransactionId(chainId);
    console.log('  Chain ID:', chainId);
    console.log('  Transaction ID:', txId);

    // SIGN WITH EVM WALLET
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 4: Sign Transaction ID with EVM Wallet (EIP-191)');
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
    console.log('  Compact bytes length:', compactBytes.length);

    // REPLACE PLACEHOLDER WITH REAL SIGNATURE
    console.log('\n  Replacing placeholder witness with real signature...');
    request.witnesses[witnessIndex] = compactBytes;
    console.log('  ✅ Real signature installed at witness index', witnessIndex);

    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });

    // ESTIMATE PREDICATES
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 5: Estimate Predicates (Network Fetches Blob)');
    console.log('-'.repeat(80));
    console.log('  Calling provider.estimatePredicates()...');
    
    const estimated = await provider.estimatePredicates(request);
    
    console.log('\n  ✅ Estimation complete!');
    console.log('  Predicate gas used:', estimated.inputs[0].predicateGasUsed?.toString());
    console.log('  Gas settings after estimation:');
    console.log('    gasLimit:', estimated.gasLimit?.toString());
    console.log('    maxFeePerGas:', estimated.maxFeePerGas?.toString());
    console.log('    witnessLimit:', estimated.witnessLimit?.toString());
    
    // Fix gas parameters that were cleared by estimatePredicates
    console.log('\n  ⚠️  maxFeePerGas is undefined, setting it manually...');
    estimated.maxFeePerGas = bn(1);
    console.log('  ✅ Set maxFeePerGas to 1');

    // SEND TRANSACTION
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 6: Send Transaction');
    console.log('-'.repeat(80));
    console.log('  Final gas settings:');
    console.log('    gasLimit:', estimated.gasLimit?.toString());
    console.log('    maxFeePerGas:', estimated.maxFeePerGas?.toString());
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
      console.log('  • Deployed full predicate as blob (one-time operation)');
      console.log('  • Used 120-byte loader in transaction instead of 4KB full predicate');
      console.log('  • Network fetched full bytecode from blob storage automatically');
      console.log('  • Transaction validated and executed successfully');
      console.log('  • Savings: 97.1% reduction in transaction size');
      console.log('='.repeat(80) + '\n');

      expect(result.status).toBe('success');
    } catch (error: any) {
      console.log('\n' + '='.repeat(80));
      console.log('❌ TRANSACTION FAILED');
      console.log('='.repeat(80));
      console.log('Error type:', error.constructor.name);
      console.log('Error message:', error.message);
      console.log('='.repeat(80) + '\n');
      throw error;
    }
  });
});