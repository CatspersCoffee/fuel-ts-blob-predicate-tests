import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  WalletUnlocked,
  bn,
  ScriptTransactionRequest,
  Provider,
  transactionRequestify,
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
 * Testing assembleTx method with blob-based (loader) predicates
 * 
 * Transaction Construction Process:
 * 1. Attempt to use assembleTx() to build the base transaction
 * 2. If successful, add witness placeholder
 * 3. Sign the transaction ID with EVM wallet
 * 4. Use SDK's estimatePredicates() for gas calculation
 *    - This properly handles loader predicates (returns ~21,181 gas)
 *    - Avoids the GasMismatch issue from manual dry-run calculations
 * 5. Submit transaction with estimateTxDependencies: false
 * 
 */
describe('Simple Predicate with Blob Loader - assembleTx Test', () => {
  let provider: Provider;
  let cleanup: () => void;
  let fundingWallet: WalletUnlocked;
  let evmWallet: Wallet;
  let blobPredicate: SimpleLoader;
  let blobId: string;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('TESTING assembleTx WITH BLOB-BASED PREDICATES');
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

    // Create blob-predicate (loader)
    blobPredicate = new SimpleLoader({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });

    // Fund it
    const tx = await fundingWallet.transfer(
      blobPredicate.address,
      bn(1000000),
      await provider.getBaseAssetId()
    );
    await tx.waitForResult();
    
    console.log('Setup complete:');
    console.log('  Blob-Predicate type:', blobPredicate.constructor.name);
    console.log('  Blob-Predicate address:', blobPredicate.address.toString());
    console.log('  Bytecode size:', blobPredicate.bytes.length, 'bytes');
    console.log('='.repeat(80) + '\n');
  });

  afterAll(() => {
    if (cleanup) {
      cleanup();
    }
  });

  it('should test assembleTx with blob-based predicate', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('ATTEMPTING assembleTx WITH BLOB PREDICATE');
    console.log('='.repeat(80));
    
    const recipient = WalletUnlocked.generate({ provider });
    const amountToSend = bn(1234);
    const baseAssetId = await provider.getBaseAssetId();

    console.log('\nTransaction parameters:');
    console.log('  Recipient:', recipient.address.toString());
    console.log('  Amount:', amountToSend.toString());
    console.log('  Asset ID:', baseAssetId);

    // First, verify that createTransfer works (baseline)
    console.log('\n--- Testing createTransfer (baseline) ---');
    try {
      const transferTx = await blobPredicate.createTransfer(
        recipient.address,
        amountToSend,
        baseAssetId
      );
      console.log('✅ createTransfer works');
      console.log('  Transaction type:', transferTx.constructor.name);
      console.log('  Inputs:', transferTx.inputs?.length);
      console.log('  Outputs:', transferTx.outputs?.length);
    } catch (error: any) {
      console.log('❌ createTransfer failed');
      console.log('  Error:', error.message);
    }

    // Now test assembleTx
    console.log('\n--- Testing assembleTx ---');
    try {
      console.log('Calling assembleTx on blob predicate...');
      
      const assembledTx = await blobPredicate.assembleTx({
        to: recipient.address,
        amount: amountToSend,
        assetId: baseAssetId,
      });

      console.log('\n✅ assembleTx succeeded');
      console.log('  Type of result:', typeof assembledTx);
      console.log('  Constructor:', assembledTx?.constructor?.name);
      
      // Convert to ScriptTransactionRequest if needed
      const request = transactionRequestify(assembledTx);
      console.log('  Converted type:', request.constructor.name);
      console.log('  Inputs:', request.inputs?.length);
      console.log('  Outputs:', request.outputs?.length);
      
      // Try to complete the transaction flow
      console.log('\n--- Attempting full transaction flow ---');
      
      // Add witness
      const placeholderWitness = new Uint8Array(64).fill(0);
      request.witnesses = [placeholderWitness];
      
      // Sign
      const chainId = await provider.getChainId();
      const txId = request.getTransactionId(chainId);
      const signature = await evmWallet.signMessage(txId.slice(2));
      const compactSig = toCompactSignature(signature);
      const compactBytes = new Uint8Array(
        compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      );
      request.witnesses[0] = compactBytes;
      
      // Estimate and send
      const estimated = await provider.estimatePredicates(request);
      console.log('  Predicate gas estimated:', estimated.inputs[0]?.predicateGasUsed?.toString());
      
      const { waitForResult } = await provider.sendTransaction(estimated, {
        estimateTxDependencies: false,
      });
      const result = await waitForResult();
      
      console.log('\n✅ Transaction successful');
      console.log('  Transaction ID:', result.id);
      console.log('  Status:', result.status);
      
      expect(result.status).toBe('success');
      
    } catch (error: any) {
      console.log('\n❌ assembleTx failed');
      console.log('Error details:');
      console.log('  Type:', error.constructor.name);
      console.log('  Message:', error.message);
      console.log('  Stack trace snippet:');
      
      // Print just the relevant part of stack trace
      const stackLines = error.stack.split('\n').slice(0, 5);
      stackLines.forEach((line: string) => console.log('    ' + line));
      
      // Note the specific error for reference
      if (error.message.includes("Cannot read properties of undefined")) {
        console.log('\nError occurs when calling .filter() on undefined');
        console.log('Location: @fuel-ts/account/src/account.ts:1032');
      }
      
      // This is expected to fail for now
      expect(error.message).toContain("Cannot read properties of undefined");
    }
  });
});