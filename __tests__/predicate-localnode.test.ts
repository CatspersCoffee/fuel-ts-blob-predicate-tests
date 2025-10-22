import { describe, it, expect, beforeAll } from 'vitest';
import {
  Provider,
  WalletUnlocked,
  bn,
  hexlify,
  ScriptTransactionRequest,
} from 'fuels';
import { Wallet } from 'ethers';
import { loadPredicate, fundPredicate } from '../src/index.js';
import { toCompactSignature } from '../src/utils/signatureUtils.js';

/**
 * EIP-191 Predicate Witness Transaction Test
 * 
 * This test demonstrates the complete flow for spending from a predicate that validates
 * EIP-191 signatures against an EVM address. The process involves several critical steps:
 * 
 * 1. PLACEHOLDER PHASE:
 *    - Build transaction with predicate inputs
 *    - Add a 64-byte placeholder witness (all zeros) to the transaction
 *    - Set witnessIndex on predicate inputs to point to the placeholder
 * 
 * 2. SIGNING PHASE:
 *    - Calculate transaction ID WITH the placeholder witness in place
 *    - Sign the transaction ID using an EVM wallet (ethers.js signMessage)
 *    - This produces a 65-byte Ethereum signature (r + s + v)
 * 
 * 3. CONVERSION PHASE:
 *    - Convert the 65-byte Ethereum signature to 64-byte compact format
 *    - The compact format encodes the v (recovery byte) into the high bit of s
 *    - Replace the placeholder witness with the compact signature
 * 
 * 4. ESTIMATION PHASE:
 *    - Call estimatePredicates() AFTER the real signature is in place
 *    - This allows the SDK to simulate predicate execution with the actual signature
 *    - The network calculates the exact gas needed for predicate verification
 * 
 * 5. SUBMISSION PHASE:
 *    - Send transaction with estimateTxDependencies: false
 *    - The network validates the predicate using ec_recover_evm_address
 *    - Transaction succeeds if recovered address matches OWNER_ADDRESS configurable
 * 
 * KEY INSIGHT:
 * The predicate uses witness index 0 DIRECTLY (hardcoded), not input_witness_index(0).
 * This means the predicate reads from the global witnesses array, not from input metadata.
 * The witnessIndex field on the input is informational but not used by this predicate.
 */
describe('Simple Predicate with Witness', () => {
  let provider: Provider;
  let wallet: WalletUnlocked;
  let evmWallet: Wallet;
  let predicate: any;

  beforeAll(async () => {
    // Connect to local node
    const url = process.env.FUEL_NETWORK_URL || 'http://127.0.0.1:4000/v1/graphql';
    provider = new Provider(url);

    // Create EVM wallet from private key (for signing)
    const evmPrivateKey = process.env.TEST_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
    evmWallet = new Wallet(evmPrivateKey);
    
    console.log('EVM Address:', evmWallet.address);

    // Create Fuel wallet from .env private key (for funding)
    const fuelPrivateKey = process.env.FUEL_LOCALNODE_PRIVATE_KEY;
    if (!fuelPrivateKey) {
      throw new Error('FUEL_LOCALNODE_PRIVATE_KEY environment variable is required (Fuel private key without 0x prefix)');
    }
    
    // Add 0x prefix if not present
    const formattedKey = fuelPrivateKey.startsWith('0x') ? fuelPrivateKey : `0x${fuelPrivateKey}`;
    wallet = new WalletUnlocked(formattedKey, provider);
    
    console.log('Fuel Wallet Address:', wallet.address.toString());

    // Load predicate with EVM address
    predicate = await loadPredicate(provider, evmWallet.address);
    console.log('Predicate Address:', predicate.address.toString());

    // Fund predicate
    await fundPredicate(wallet, predicate, '1000000');
  });

  it('should successfully spend from predicate with EIP-191 signature', async () => {
    // Create a simple transaction
    const recipient = WalletUnlocked.generate({ provider });
    const amountToSend = bn(1234);

    // Build transaction request
    const request = new ScriptTransactionRequest({
      gasLimit: bn(1000),
    });

    // Add predicate input
    const resources = await predicate.getResourcesToSpend([
      {
        amount: amountToSend,
        assetId: await provider.getBaseAssetId(),
      },
    ]);

    request.addResources(resources);

    // Add output
    request.addCoinOutput(
      recipient.address,
      amountToSend,
      await provider.getBaseAssetId()
    );

    // Add change output back to predicate
    request.addChangeOutput(
      predicate.address,
      await provider.getBaseAssetId()
    );

    // Add placeholder witness (64 bytes of zeros)
    const placeholderWitness = new Uint8Array(64).fill(0);
    const witnessIndex = request.witnesses.length;
    request.witnesses.push(placeholderWitness);

    // Set witness index on predicate inputs
    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });

    // Get transaction ID
    const chainId = await provider.getChainId();
    const txId = request.getTransactionId(chainId);
    console.log('Transaction ID (with placeholder):', txId);

    // Sign with EVM wallet (EIP-191)
    const txIdString = txId.slice(2); // Remove '0x'
    const signature = await evmWallet.signMessage(txIdString);
    console.log('Signature:', signature);

    // Convert to compact format using utility function
    const compactSig = toCompactSignature(signature);
    console.log('Compact signature:', compactSig);
    console.log('Compact signature length:', compactSig.length, '(should be 130)');

    // Convert hex string to bytes
    const compactBytes = new Uint8Array(
        compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    console.log('Compact bytes length:', compactBytes.length, '(should be 64)');

    // Replace placeholder with real signature
    request.witnesses[witnessIndex] = compactBytes;

    // Set witness index on predicate inputs
    request.inputs.forEach((input) => {
    if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
    }
    });

    console.log('\nBEFORE estimatePredicates - witnessIndex:', request.inputs[0].witnessIndex);

    console.log('\n🔬 Estimating predicates...');

    // Estimate predicates
    const estimated = await provider.estimatePredicates(request);

    console.log('AFTER estimatePredicates - witnessIndex:', estimated.inputs[0].witnessIndex);
    console.log('Estimated predicateGasUsed:', estimated.inputs[0].predicateGasUsed);

    console.log('\n📋 Complete Transaction Object:');
    console.log(JSON.stringify(estimated, null, 2));

    // Send transaction
    console.log('\n🚀 Sending transaction...');

    const { waitForResult } = await provider.sendTransaction(estimated, {
    estimateTxDependencies: false,
    });

    const result = await waitForResult();

    console.log('✅ Transaction succeeded!');
    console.log('Transaction ID:', result.id);
    console.log('Status:', result.status);

    expect(result.status).toBe('success');
  });
});