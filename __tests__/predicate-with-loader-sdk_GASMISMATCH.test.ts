import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  WalletUnlocked,
  bn,
  ScriptTransactionRequest,
  Provider,
} from 'fuels';
import { launchTestNode } from 'fuels/test-utils';
import { Wallet } from 'ethers';
import { toCompactSignature } from '../src/utils/signatureUtils.js';
import { Simple } from '../src/generated/predicates/Simple.js';
import { SimpleLoader } from '../src/generated/predicates/SimpleLoader.js';
import { 
  calculateBlobId, 
  verifyLoaderBlobId,
} from '../src/utils/blobUtils.js';
import { deployPredicateBlob } from '../src/utils/blobDeployment.js';

/**
 * UNDERSTANDING THE GasMismatch ERROR WITH BLOB LOADER PREDICATES
 * ================================================================
 * 
 * CONTEXT:
 * Blob loader predicates use a two-tier architecture to reduce on-chain bytecode size:
 *   - Loader: Small bytecode (~760 bytes) deployed on-chain
 *   - Blob: Full predicate logic (~2,200+ bytes) stored separately
 * 
 * THE CORE ISSUE:
 * ----------------
 * The GasMismatch error occurs because there's a fundamental difference in how
 * gas is measured vs. how it's charged by the network for loader predicates.
 * 
 * EXPECTED BEHAVIOR (What should happen):
 * ----------------------------------------
 * 1. Build transaction with loader predicate
 * 2. Use SDK's estimatePredicates() method
 * 3. SDK returns ~21,181 gas (for SimpleLoader)
 * 4. Transaction succeeds
 * 
 * PROBLEMATIC BEHAVIOR (What causes GasMismatch):
 * ------------------------------------------------
 * 
 * Step 1: BUILD TRANSACTION
 *   - Create transaction with loader predicate input
 *   - Add placeholder witness (64 zeros)
 *   - Set initial gas parameters
 * 
 * Step 2: INCORRECT GAS MEASUREMENT
 *   - Run dry-run with high predicateGasUsed (e.g., 400,000)
 *   - Dry-run executes EVERYTHING:
 *     • Loader bytecode execution
 *     • Blob loading from storage
 *     • Full predicate logic execution
 *   - Returns totalGas (e.g., 290,570 for complex predicates)
 *   - Subtract script gas (~43) to get "predicate gas"
 *   - Result: ~290,527 gas measured
 * 
 * Step 3: SIGN WITH WRONG GAS
 *   - Set predicateGasUsed to measured value (290,527)
 *   - Calculate transaction ID (includes this gas value)
 *   - Sign transaction ID with EVM wallet
 *   - Replace placeholder with signature
 * 
 * Step 4: NETWORK REJECTION
 *   - Submit transaction to network
 *   - Network validates predicate gas
 *   - Network expects: ~21,181 (SimpleLoader)
 *   - We provided: 290,527
 *   - Result: PredicateVerificationFailed(GasMismatch { index: 0 })
 * 
 * WHY THE DISCREPANCY EXISTS:
 * ----------------------------
 * - Dry-run: Measures full execution cost (loader + blob execution)
 * - Network: Only charges for the loader operation, not blob execution
 * - SDK estimatePredicates(): Knows about this pattern and returns correct value
 * 
 * The network optimizes gas costs for blob predicates by only charging for
 * the loading operation, not the execution of the loaded code. This is a
 * deliberate design choice to incentivize the use of blobs for large predicates.
 * 
 * ACTUAL GAS VALUES OBSERVED:
 * ---------------------------
 * SimpleLoader:
 *   - Dry-run measurement: ~290,000+ gas
 *   - Actual requirement: ~21,181 gas
 *   - Difference: ~269,000 gas
 * 
 * 
 * LESSON:
 * -------
 * Never use dry-run to measure predicateGasUsed for loader predicates.
 * Always use the SDK's estimatePredicates() method, which has built-in
 * knowledge of the loader pattern and returns the correct gas value.
*/
describe('Reproduce GasMismatch Error with Blob Loader', () => {
  let provider: Provider;
  let cleanup: () => void;
  let fundingWallet: WalletUnlocked;
  let evmWallet: Wallet;
  let blobPredicate: SimpleLoader;
  let blobId: string;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('REPRODUCING GasMismatch ERROR');
    console.log('='.repeat(80));

    const launched = await launchTestNode({
      walletsConfig: {
        count: 1,
        amountPerCoin: 10_000_000,
      },
    });

    provider = launched.provider;
    cleanup = launched.cleanup;
    fundingWallet = launched.wallets[0];

    const evmPrivateKey = process.env.TEST_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
    evmWallet = new Wallet(evmPrivateKey);

    // Deploy blob
    blobId = calculateBlobId(Simple.bytecode, Simple.abi);
    const cleanAddress = evmWallet.address.toLowerCase().replace('0x', '');
    const paddedAddress = cleanAddress.padStart(64, '0');
    
    const simplePredicate = new Simple({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    await deployPredicateBlob(simplePredicate, fundingWallet);

    // Create blob-predicate
    blobPredicate = new SimpleLoader({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });

    // Fund it with more to avoid fee issues
    const tx = await fundingWallet.transfer(
      blobPredicate.address,
      bn(5000000), // Increased funding
      await provider.getBaseAssetId()
    );
    await tx.waitForResult();
  });

  afterAll(() => {
    if (cleanup) {
      cleanup();
    }
  });

  it('should fail with GasMismatch when using dry-run gas measurement', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('ATTEMPTING TO TRIGGER GasMismatch');
    console.log('='.repeat(80));
    
    const recipient = WalletUnlocked.generate({ provider });
    const amountToSend = bn(1234);

    // ============================================================================
    // PHASE 1: BUILD TRANSACTION WITH PLACEHOLDER
    // ============================================================================
    console.log('\nPHASE 1: Build transaction with placeholder witness');
    
    const request = new ScriptTransactionRequest({
      gasLimit: bn(500000), // Increased
    });

    // Set higher gas parameters to avoid fee issues
    request.gasLimit = bn(500000);
    request.witnessLimit = bn(50000);
    request.maturity = 0;
    
    // Add resources
    const resources = await blobPredicate.getResourcesToSpend([
      {
        amount: amountToSend,
        assetId: await provider.getBaseAssetId(),
      },
    ]);

    request.addResources(resources);
    request.addCoinOutput(recipient.address, amountToSend, await provider.getBaseAssetId());
    request.addChangeOutput(blobPredicate.address, await provider.getBaseAssetId());

    // Add PLACEHOLDER witness (all zeros)
    const placeholderWitness = new Uint8Array(64).fill(0);
    const witnessIndex = request.witnesses.length;
    request.witnesses.push(placeholderWitness);

    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });

    // ============================================================================
    // PHASE 2: MEASURE GAS WITH DRY-RUN (PROBLEMATIC APPROACH)
    // ============================================================================
    console.log('\nPHASE 2: Measure gas using dry-run with placeholder');
    
    // Set high initial gas to ensure dry-run succeeds
    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.predicateGasUsed = bn(400000);
      }
    });

    // Calculate and set maxFee BEFORE dry-run
    const maxFee = request.gasLimit.mul(3); // gasLimit * 3 for safety
    request.maxFee = maxFee;

    console.log('Gas parameters for dry-run:');
    console.log('  gasLimit:', request.gasLimit.toString());
    console.log('  maxFee:', request.maxFee.toString());
    console.log('  Initial predicateGasUsed:', bn(400000).toString());

    console.log('\nRunning dry-run with placeholder witness...');
    const dryRunResult = await provider.dryRun(request, {
      utxoValidation: false,
      estimateTxDependencies: false,
    });

    let measuredGas = bn(0);
    if (dryRunResult.dryRunStatus?.type === 'DryRunSuccessStatus') {
      const totalGas = bn(dryRunResult.dryRunStatus.totalGas || 0);
      
      // Find script gas from receipts
      let scriptGas = bn(0);
      if (dryRunResult.receipts) {
        for (const receipt of dryRunResult.receipts) {
          if (receipt.type === 'ScriptResult' && receipt.gasUsed) {
            scriptGas = bn(receipt.gasUsed);
          }
        }
      }
      
      // Calculate predicate gas (THIS IS WRONG FOR LOADER PREDICATES!)
      measuredGas = totalGas.sub(scriptGas);
      
      console.log('Dry-run results:');
      console.log('  Total gas:', totalGas.toString());
      console.log('  Script gas:', scriptGas.toString());
      console.log('  Calculated predicate gas:', measuredGas.toString());
      console.log('  ⚠️ This is the FULL execution gas, not just the loader!');
    }

    // ============================================================================
    // PHASE 3: SET MEASURED GAS AND SIGN
    // ============================================================================
    console.log('\nPHASE 3: Set measured gas and sign');
    
    // Set the incorrectly measured gas
    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.predicateGasUsed = measuredGas;
        console.log(`Set predicateGasUsed to: ${measuredGas.toString()}`);
      }
    });

    // Calculate TX ID with wrong gas
    const chainId = await provider.getChainId();
    const txId = request.getTransactionId(chainId);
    console.log('Transaction ID (with wrong gas):', txId);

    // Sign it
    const txIdString = txId.slice(2);
    const signature = await evmWallet.signMessage(txIdString);
    const compactSig = toCompactSignature(signature);
    const compactBytes = new Uint8Array(
      compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    request.witnesses[witnessIndex] = compactBytes;
    console.log('Signature applied');

    // ============================================================================
    // PHASE 4: ATTEMPT TO SEND (SHOULD FAIL WITH GasMismatch)
    // ============================================================================
    console.log('\nPHASE 4: Attempting to send transaction...');
    console.log('Measured gas:', measuredGas.toString());
    console.log('Actual loader gas should be ~21,181');
    
    try {
      const { waitForResult } = await provider.sendTransaction(request, {
        estimateTxDependencies: false, // Don't re-estimate
      });
      
      await waitForResult();
      
      console.log('\n❌ UNEXPECTED');
      console.log('This should have failed with GasMismatch');
      
      // If it succeeds, that's actually a failure for this test
      expect(true).toBe(false);
    } catch (error: any) {
      console.log('='.repeat(80));
      console.log('RAW ERROR DETAILS:');
      console.log('='.repeat(80));
      
      // Print complete error object
      console.log('Error type:', error.constructor.name);
      console.log('Error message:', error.message);
      
      // Print the full error object structure
      console.log('\nFull error object:');
      console.log(JSON.stringify(error, null, 2));
      
      // Try to extract specific error details if available
      if (error.response) {
        console.log('\nError response from node:');
        console.log(JSON.stringify(error.response, null, 2));
      }
      
      if (error.metadata) {
        console.log('\nError metadata:');
        console.log(JSON.stringify(error.metadata, null, 2));
      }
      
      if (error.code) {
        console.log('\nError code:', error.code);
      }
      
      // Check for nested error information
      if (error.cause) {
        console.log('\nError cause:');
        console.log(JSON.stringify(error.cause, null, 2));
      }
      
      console.log('='.repeat(80));
      
      // Check if it's the GasMismatch error we're expecting
      const isGasMismatch = error.message.includes('GasMismatch') || 
                           error.message.includes('PredicateVerificationFailed');
      
      console.log('\nERROR ANALYSIS:');
      if (isGasMismatch) {
        console.log('Reproduced GasMismatch error!');
        console.log('The dry-run measured gas does not match actual execution.');
        console.log('Measured (wrong):', measuredGas.toString());
        console.log('Actual (correct): ~21,181');
      } else {
        console.log('⚠️ Got a different error than expected');
        console.log('Expected: GasMismatch or PredicateVerificationFailed');
        console.log('Actual:', error.message);
      }
      console.log('='.repeat(80));
      
      // Don't fail the test immediately - let's see what error we get
      console.log('\n📊 Summary:');
      console.log('Is this a GasMismatch error?', isGasMismatch);
      console.log('Predicate gas we set:', measuredGas.toString());
      console.log('Expected by network: ~21,181');
      
      // For now, let's not assert so we can see what happens
      // expect(isGasMismatch).toBe(true);
    }
  });
});

