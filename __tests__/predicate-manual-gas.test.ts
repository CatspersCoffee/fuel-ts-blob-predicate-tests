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
 * MANUAL GAS: Blob Predicate Test that bypasses estimatePredicates
 * 
 * This test manually sets gas values based on known requirements,
 * completely avoiding the problematic estimatePredicates() function.
 */
describe('Simple Predicate with Manual Gas Settings', () => {
  let provider: Provider;
  let cleanup: () => void;
  let fundingWallet: WalletUnlocked;
  let evmWallet: Wallet;
  let blobPredicate: SimpleLoader;
  let blobId: string;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('BLOB PREDICATE TEST - MANUAL GAS APPROACH');
    console.log('='.repeat(80));

    // Launch test node
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

    const baseAssetId = await provider.getBaseAssetId();

    // Create EVM wallet
    const evmPrivateKey = process.env.TEST_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
    evmWallet = new Wallet(evmPrivateKey);
    console.log('EVM Address:', evmWallet.address);

    // Calculate BlobID
    blobId = calculateBlobId(Simple.bytecode, Simple.abi);
    console.log('Calculated BlobID:', blobId);
    
    // Deploy blob
    const cleanAddress = evmWallet.address.toLowerCase().replace('0x', '');
    const paddedAddress = cleanAddress.padStart(64, '0');
    
    const simplePredicate = new Simple({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    console.log('Deploying blob...');
    const deployResult = await deployPredicateBlob(simplePredicate, fundingWallet);
    console.log('Blob deployed:', deployResult.blobId);

    // Create loader predicate
    blobPredicate = new SimpleLoader({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    console.log('Loader Predicate Address:', blobPredicate.address.toString());

    // Fund predicate
    const tx = await fundingWallet.transfer(
      blobPredicate.address,
      bn(1000000),
      baseAssetId
    );
    await tx.waitForResult();
    
    console.log('✅ Predicate funded');
    console.log('='.repeat(80) + '\n');
  });

  afterAll(() => {
    if (cleanup) {
      cleanup();
    }
  });

  it('should spend from blob-predicate using MANUAL gas settings', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('MANUAL GAS TRANSACTION TEST');
    console.log('='.repeat(80));
    
    const recipient = WalletUnlocked.generate({ provider });
    const amountToSend = bn(1234);

    // Build transaction WITHOUT estimation
    console.log('\n📦 Building transaction with MANUAL gas values...');
    
    // KNOWN GAS VALUES (from your previous test output)
    const PREDICATE_GAS_USED = bn(21181); // We know this from the estimation output
    const BASE_GAS = bn(50000);           // Base transaction gas
    const TOTAL_GAS = BASE_GAS.add(PREDICATE_GAS_USED).mul(120).div(100); // 20% buffer
    
    const request = new ScriptTransactionRequest({
      // Set gas values IMMEDIATELY in constructor
      gasLimit: TOTAL_GAS,
      maxFeePerGas: bn(1),
      witnessLimit: bn(10000),
    });
    
    console.log('Manual gas settings:');
    console.log('  gasLimit:', request.gasLimit?.toString());
    console.log('  maxFeePerGas:', request.maxFeePerGas?.toString());
    console.log('  witnessLimit:', request.witnessLimit?.toString());

    // Get resources
    const resources = await blobPredicate.getResourcesToSpend([
      {
        amount: amountToSend,
        assetId: await provider.getBaseAssetId(),
      },
    ]);

    request.addResources(resources);
    request.addCoinOutput(recipient.address, amountToSend, await provider.getBaseAssetId());
    request.addChangeOutput(blobPredicate.address, await provider.getBaseAssetId());
    
    // Manually set predicate gas on the input
    if (request.inputs[0] && 'predicateGasUsed' in request.inputs[0]) {
      (request.inputs[0] as any).predicateGasUsed = PREDICATE_GAS_USED;
      console.log('  Set predicateGasUsed on input:', PREDICATE_GAS_USED.toString());
    }

    // Add witness
    const placeholderWitness = new Uint8Array(64).fill(0);
    const witnessIndex = request.witnesses.length;
    request.witnesses.push(placeholderWitness);

    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });

    // Sign transaction
    const chainId = await provider.getChainId();
    const txId = request.getTransactionId(chainId);
    console.log('\n🔏 Signing transaction ID:', txId);
    
    const txIdString = txId.slice(2);
    const signature = await evmWallet.signMessage(txIdString);
    const compactSig = toCompactSignature(signature);
    const compactBytes = new Uint8Array(
      compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    
    request.witnesses[witnessIndex] = compactBytes;
    console.log('  Signature installed');

    // CRITICAL: Re-verify gas parameters before sending
    console.log('\n⚠️  Verifying gas parameters before send:');
    console.log('  gasLimit:', request.gasLimit?.toString());
    console.log('  maxFeePerGas:', request.maxFeePerGas?.toString());
    console.log('  witnessLimit:', request.witnessLimit?.toString());
    
    // Double-check by creating a new request with the same values
    const finalRequest = new ScriptTransactionRequest({
      gasLimit: TOTAL_GAS,
      maxFeePerGas: bn(1),
      witnessLimit: bn(10000),
      script: request.script,
      scriptData: request.scriptData,
    });
    
    // Copy everything over
    request.inputs.forEach((input) => finalRequest.inputs.push({...input}));
    request.outputs.forEach((output) => finalRequest.outputs.push({...output}));
    request.witnesses.forEach((witness) => finalRequest.witnesses.push(witness));
    
    console.log('\n📤 Sending transaction (NO estimation, manual gas)...');
    console.log('  Final gasLimit:', finalRequest.gasLimit?.toString());
    console.log('  Final maxFeePerGas:', finalRequest.maxFeePerGas?.toString());
    
    try {
      // Send WITHOUT estimateTxDependencies
      const { waitForResult } = await provider.sendTransaction(finalRequest, {
        estimateTxDependencies: false,
      });
      
      const result = await waitForResult();

      console.log('\n' + '='.repeat(80));
      console.log('✅ TRANSACTION SUCCESSFUL!');
      console.log('='.repeat(80));
      console.log('Transaction ID:', result.id);
      console.log('Status:', result.status);
      console.log('Gas used:', result.gasUsed?.toString());
      console.log('='.repeat(80) + '\n');

      expect(result.status).toBe('success');
    } catch (error: any) {
      console.log('\n' + '='.repeat(80));
      console.log('❌ TRANSACTION FAILED');
      console.log('='.repeat(80));
      console.log('Error:', error.message);
      
      // Deep debug
      console.log('\n🔍 Deep debugging the request object:');
      const anyRequest = finalRequest as any;
      console.log('  Type:', finalRequest.constructor.name);
      console.log('  Has gasLimit property:', 'gasLimit' in finalRequest);
      console.log('  Has maxFeePerGas property:', 'maxFeePerGas' in finalRequest);
      
      // Try to access internal structure
      if (anyRequest._gasLimit !== undefined) {
        console.log('  Internal _gasLimit:', anyRequest._gasLimit?.toString());
      }
      if (anyRequest._maxFeePerGas !== undefined) {
        console.log('  Internal _maxFeePerGas:', anyRequest._maxFeePerGas?.toString());
      }
      
      // Log all enumerable properties
      console.log('\n  All properties:');
      for (const key in finalRequest) {
        if (finalRequest.hasOwnProperty(key)) {
          const value = (finalRequest as any)[key];
          if (value && typeof value === 'object' && 'toString' in value) {
            console.log(`    ${key}:`, value.toString());
          }
        }
      }
      
      console.log('='.repeat(80) + '\n');
      throw error;
    }
  });
});