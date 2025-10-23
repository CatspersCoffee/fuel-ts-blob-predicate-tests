import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  WalletUnlocked,
  bn,
  ScriptTransactionRequest,
  Provider,
  transactionRequestify,
  TransactionType,
} from 'fuels';
import { launchTestNode } from 'fuels/test-utils';
import { Wallet } from 'ethers';
import { toCompactSignature } from '../src/utils/signatureUtils.js';
import { Simple } from '../src/generated/predicates/Simple.js';

/**
 * Testing assembleTx with FULL predicates (not blob/loader predicates)
 * 
 * This test uses the complete Simple predicate bytecode (4112 bytes)
 * directly, without the blob loader pattern, to determine if assembleTx
 * incompatibility is specific to loader predicates or affects all predicates.
 * 
 * Transaction flow:
 * 1. Attempt assembleTx on full predicate
 * 2. If successful, convert to TransactionRequest
 * 3. Add witness and sign
 * 4. Use estimatePredicates for gas calculation
 * 5. Submit transaction
 */
describe('Simple Predicate (Full) - assembleTx Test', () => {
  let provider: Provider;
  let cleanup: () => void;
  let fundingWallet: WalletUnlocked;
  let evmWallet: Wallet;
  let simplePredicate: Simple;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('TESTING assembleTx WITH FULL PREDICATE (NOT LOADER)');
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

    const cleanAddress = evmWallet.address.toLowerCase().replace('0x', '');
    const paddedAddress = cleanAddress.padStart(64, '0');
    
    // Create FULL predicate instance (not loader)
    simplePredicate = new Simple({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    console.log('Full Predicate Details:');
    console.log('  Type:', simplePredicate.constructor.name);
    console.log('  Address:', simplePredicate.address.toString());
    console.log('  Bytecode size:', simplePredicate.bytes.length, 'bytes');
    console.log('  Uses blob pattern: NO - this is the full predicate');

    // Fund the predicate
    const tx = await fundingWallet.transfer(
      simplePredicate.address,
      bn(1000000),
      await provider.getBaseAssetId()
    );
    await tx.waitForResult();
    
    const balance = await provider.getBalance(simplePredicate.address, await provider.getBaseAssetId());
    console.log('  Funded with:', balance.toString(), 'units');
    console.log('='.repeat(80) + '\n');
  });

  afterAll(() => {
    if (cleanup) {
      cleanup();
    }
  });

  it('should test assembleTx with full predicate (not loader)', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('ATTEMPTING assembleTx WITH FULL PREDICATE');
    console.log('='.repeat(80));
    
    const recipient = WalletUnlocked.generate({ provider });
    const amountToSend = bn(1234);
    const baseAssetId = await provider.getBaseAssetId();

    console.log('\nTransaction parameters:');
    console.log('  Recipient:', recipient.address.toString());
    console.log('  Amount:', amountToSend.toString());
    console.log('  Asset ID:', baseAssetId);

    // First test createTransfer as baseline
    console.log('\n--- Testing createTransfer (baseline) ---');
    try {
      const transferTx = await simplePredicate.createTransfer(
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
    console.log('\n--- Testing assembleTx with FULL predicate ---');
    try {
      console.log('Calling assembleTx on full predicate...');
      
      const assembledTx = await simplePredicate.assembleTx({
        to: recipient.address,
        amount: amountToSend,
        assetId: baseAssetId,
      });

      console.log('\n✅ assembleTx succeeded!');
      console.log('  Type of result:', typeof assembledTx);
      console.log('  Constructor:', assembledTx?.constructor?.name);
      
      // Convert to TransactionRequest
      const request = transactionRequestify(assembledTx);
      
      // Ensure it's a ScriptTransactionRequest
      if (request.type !== TransactionType.Script) {
        throw new Error('Expected Script transaction type');
      }
      
      const scriptRequest = request as ScriptTransactionRequest;
      console.log('  Converted type:', scriptRequest.constructor.name);
      console.log('  Inputs:', scriptRequest.inputs?.length);
      console.log('  Outputs:', scriptRequest.outputs?.length);
      
      // Complete transaction flow
      console.log('\n--- Attempting full transaction flow ---');
      
      // Add witness
      const placeholderWitness = new Uint8Array(64).fill(0);
      scriptRequest.witnesses = [placeholderWitness];
      
      // Set witness index on predicate inputs
      scriptRequest.inputs.forEach((input) => {
        if ('predicate' in input && input.predicate) {
          input.witnessIndex = 0;
        }
      });
      
      // Sign
      const chainId = await provider.getChainId();
      const txId = scriptRequest.getTransactionId(chainId);
      console.log('  Transaction ID:', txId);
      
      const signature = await evmWallet.signMessage(txId.slice(2));
      const compactSig = toCompactSignature(signature);
      const compactBytes = new Uint8Array(
        compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      );
      scriptRequest.witnesses[0] = compactBytes;
      console.log('  Signature applied');
      
      // Estimate predicate gas
      console.log('  Estimating predicate gas...');
      const estimated = await provider.estimatePredicates(scriptRequest);
      console.log('  Predicate gas estimated:', estimated.inputs[0]?.predicateGasUsed?.toString());
      
      // Send transaction
      const { waitForResult } = await provider.sendTransaction(estimated, {
        estimateTxDependencies: false,
      });
      const result = await waitForResult();
      
      console.log('\n✅ Transaction successful!');
      console.log('  Transaction ID:', result.id);
      console.log('  Status:', result.status);
      console.log('  Gas used:', result.gasUsed?.toString());
      
      console.log('\n' + '='.repeat(80));
      console.log('RESULT: assembleTx WORKS with full predicates');
      console.log('='.repeat(80));
      
      expect(result.status).toBe('success');
      
    } catch (error: any) {
      console.log('\n❌ assembleTx failed');
      console.log('Error details:');
      console.log('  Type:', error.constructor.name);
      console.log('  Message:', error.message);
      console.log('  Stack trace snippet:');
      
      const stackLines = error.stack.split('\n').slice(0, 5);
      stackLines.forEach((line: string) => console.log('    ' + line));
      
      if (error.message.includes("Cannot read properties of undefined")) {
        console.log('\nError occurs when calling .filter() on undefined');
        console.log('Location: @fuel-ts/account/src/account.ts:1032');
        console.log('\n' + '='.repeat(80));
        console.log('RESULT: assembleTx FAILS with full predicates too');
        console.log('Issue is NOT specific to blob/loader predicates');
        console.log('='.repeat(80));
      }
      
      // Expect the same error as with loader predicates
      expect(error.message).toContain("Cannot read properties of undefined");
    }
  });
});