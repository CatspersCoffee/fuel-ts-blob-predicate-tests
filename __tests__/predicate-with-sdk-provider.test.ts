/**
 * ============================================================================
 * PREDICATE TRANSACTION WITH WITNESS SIGNATURE - COMPLETE PROCEDURE
 * ============================================================================
 * 
 * This procedure demonstrates the EXACT ORDER of operations required to build,
 * sign, and submit a predicate transaction that uses witness data for validation.
 * 
 * CRITICAL: The order of operations matters! Changing the order will cause the
 * transaction to fail because the transaction ID will be different from what
 * was signed.
 * 
 * ============================================================================
 * PHASE 1: BUILD INITIAL TRANSACTION STRUCTURE
 * ============================================================================
 * 
 * 1.1 Create a base transaction request
 *     - Use ScriptTransactionRequest (not CreateTransactionRequest)
 *     - Do NOT set gasLimit or maxFee yet
 * 
 * 1.2 Add predicate resources (inputs)
 *     - Call predicate.getResourcesToSpend() to fetch UTXOs
 *     - Add resources to the transaction request
 *     - This automatically populates predicateData on inputs
 * 
 * 1.3 Add transaction outputs
 *     - Add CoinOutput for the recipient (where funds are being sent)
 *     - Add ChangeOutput back to predicate address (for leftover funds)
 * 
 * 1.4 Add placeholder witness
 *     - Create a 64-byte array filled with zeros: new Uint8Array(64).fill(0)
 *     - Push this placeholder into request.witnesses array
 *     - Store the witness index (it will be request.witnesses.length - 1)
 * 
 * 1.5 Link witness to predicate inputs
 *     - Loop through request.inputs
 *     - For any input that has a 'predicate' property, set input.witnessIndex
 *     - This tells the predicate which witness to use (though your predicate
 *       hardcodes witness index 0, this step is still required by the SDK)
 * 
 * ============================================================================
 * PHASE 2: ESTIMATE TRANSACTION COST (BEFORE SIGNING!)
 * ============================================================================
 * 
 * 2.1 Calculate transaction cost WITH PLACEHOLDER
 *     - Call predicate.getTransactionCost(request)
 *     - This simulates the transaction and calculates the required gas
 *     - IMPORTANT: Do this BEFORE signing, while placeholder is still in place
 *     - This returns: { gasUsed, maxFee, minFee, ... }
 * 
 * 2.2 Set gas parameters on the request
 *     - Set request.gasLimit = txCost.gasUsed
 *     - Set request.maxFee = txCost.maxFee
 *     - These fields become part of the transaction structure
 *     - They WILL BE INCLUDED in the transaction ID calculation
 * 
 * WHY THIS ORDER MATTERS:
 * - The transaction ID is a hash of ALL transaction fields including gas params
 * - You must sign the FINAL transaction ID (with gas params set)
 * - If you set gas params AFTER signing, the txId changes and signature is invalid
 * 
 * ============================================================================
 * PHASE 3: CALCULATE TRANSACTION ID AND SIGN
 * ============================================================================
 * 
 * 3.1 Get the chain ID
 *     - Call provider.getChainId()
 *     - Required for transaction ID calculation
 * 
 * 3.2 Calculate the transaction ID
 *     - Call request.getTransactionId(chainId)
 *     - This returns a 32-byte hash (0x prefixed hex string)
 *     - This txId includes: inputs, outputs, witnesses, gasLimit, maxFee, etc.
 *     - The placeholder witness is INCLUDED in this hash
 * 
 * 3.3 Sign the transaction ID using EIP-191 Personal Sign
 *     - Remove the '0x' prefix: txIdString = txId.slice(2)
 *     - Sign the STRING representation of the hex (not raw bytes!)
 *     - For ethers.js: await evmWallet.signMessage(txIdString)
 *     - For viem: await signMessage({ message: txIdString, privateKey })
 *     - This produces a 65-byte signature (r: 32 bytes, s: 32 bytes, v: 1 byte)
 * 
 * EIP-191 SIGNING PROCESS (what happens under the hood):
 *   a) Convert txId hex to UTF-8 bytes (64 bytes representing ASCII hex chars)
 *   b) Prepend "\x19Ethereum Signed Message:\n64" (28 bytes)
 *   c) Concatenate: prefix (28 bytes) + utf8TxId (64 bytes) = 92 bytes
 *   d) Hash with Keccak-256 to get the message hash (32 bytes)
 *   e) Sign the message hash with ECDSA using the private key
 *   f) Append recovery byte 'v' (27 or 28) to get 65-byte signature
 * 
 * 3.4 Convert signature to compact format
 *     - Standard format: r (32) + s (32) + v (1) = 65 bytes
 *     - Compact format: r (32) + s_with_parity (32) = 64 bytes
 *     - The v value (recovery ID) is encoded into the high bit of s
 *     - Use toCompactSignature() utility function for this conversion
 *     - Convert hex string to Uint8Array of bytes
 * 
 * 3.5 Replace the placeholder witness with real signature
 *     - request.witnesses[witnessIndex] = compactSignatureBytes
 *     - The transaction structure now has the real signature
 *     - IMPORTANT: This does NOT change the transaction ID!
 *     - Why? Because witnesses are hashed separately in Fuel transactions
 * 
 * ============================================================================
 * PHASE 4: ESTIMATE PREDICATES (WITH REAL SIGNATURE)
 * ============================================================================
 * 
 * 4.1 Call provider.estimatePredicates(request)
 *     - This submits the transaction to the node for DRY RUN execution
 *     - The node executes the predicate code with the REAL signature
 *     - It calculates the exact gas consumed by predicate verification
 *     - Returns a new request object with predicateGasUsed set on inputs
 * 
 * 4.2 What estimatePredicates does:
 *     - Node runs: ec_recover_evm_address(compactSignature, personal_sign_hash(txId))
 *     - Recovers the Ethereum address from the signature
 *     - Compares recovered address with OWNER_ADDRESS configurable
 *     - If match: predicate returns true (1), gas consumption recorded
 *     - If no match: predicate returns false (0), transaction would fail
 *     - Sets input.predicateGasUsed to the measured gas consumption
 * 
 * 4.3 Verify the transaction ID hasn't changed
 *     - Calculate: finalTxId = estimated.getTransactionId(chainId)
 *     - Assert: finalTxId === originalTxId (should be true)
 *     - If different, the signature is now invalid and TX will fail!
 * 
 * WHY estimatePredicates AFTER signing:
 * - The predicate needs the REAL signature to verify correctly
 * - With placeholder, predicate would fail (signature verification fails)
 * - estimatePredicates only updates predicateGasUsed (doesn't change txId)
 * 
 * ============================================================================
 * PHASE 5: SUBMIT TRANSACTION
 * ============================================================================
 * 
 * 5.1 Send the transaction to the network
 *     - Call provider.sendTransaction(estimated, { estimateTxDependencies: false })
 *     - Set estimateTxDependencies: false to skip re-estimation
 *     - Why? We already estimated predicates manually in step 4
 *     - Returns a transaction response with waitForResult() method
 * 
 * 5.2 Wait for transaction to be included in a block
 *     - Call await waitForResult()
 *     - This polls the node until transaction is finalized
 *     - Returns transaction result with status, receipts, etc.
 * 
 * 5.3 On-chain predicate verification
 *     - Node validates the predicate during execution
 *     - Calls predicate main() function with witness data
 *     - Predicate reads witness[0] to get the compact signature
 *     - Calculates personal_sign_hash(tx_id())
 *     - Recovers address using ec_recover_evm_address()
 *     - Compares with OWNER_ADDRESS configurable
 *     - If match: returns true, transaction succeeds
 *     - If no match: returns false, transaction fails with PredicateVerificationFailed
 * 
 * ============================================================================
 * COMMON PITFALLS AND ERRORS
 * ============================================================================
 * 
 * ERROR: "PredicateVerificationFailed"
 * - Cause: Signature verification failed in the predicate
 * - Reasons:
 *   1. Wrong address in OWNER_ADDRESS configurable
 *   2. Signed wrong transaction ID (gas params changed after signing)
 *   3. Incorrect signature format (not compact, or wrong byte order)
 *   4. Signed with wrong private key
 *   5. EIP-191 format mismatch (signed bytes instead of UTF-8 string)
 * 
 * ERROR: "The provided max fee can't cover the transaction cost"
 * - Cause: maxFee is 0 or too low
 * - Solution: Call getTransactionCost() and set maxFee before sending
 * 
 * ERROR: Transaction ID mismatch
 * - Cause: Modified transaction after signing (changed gas, added inputs, etc.)
 * - Solution: Set ALL transaction parameters before calculating txId and signing
 * 
 * ERROR: "Insufficient funds"
 * - Cause: Predicate doesn't have enough balance to cover amount + fees
 * - Solution: Fund predicate with more assets before building transaction
 * 
 * ============================================================================
 * TRANSACTION ID COMPOSITION (WHAT GETS HASHED)
 * ============================================================================
 * 
 * The transaction ID is a hash of these fields (in order):
 * - Transaction type (Script = 0)
 * - Gas price
 * - Gas limit (set in phase 2)
 * - Maturity
 * - Script bytecode
 * - Script data
 * - Inputs (including predicate bytecode and predicateData)
 * - Outputs
 * - Witness count (NOT witness data itself!)
 * 
 * CRITICAL: Witness DATA is NOT included in transaction ID
 * - Only the witness COUNT is hashed
 * - This allows signatures to be added after txId calculation
 * - But you must have the placeholder witness present to get correct count
 * 
 * ============================================================================
 * COMPLETE CODE EXAMPLE
 * ============================================================================
 */

async function buildSignAndSubmitPredicateTransaction() {
  // ===== PHASE 1: BUILD INITIAL TRANSACTION STRUCTURE =====
  
  const amountToSend = bn(1234);
  const recipientAddress = Address.fromString('0x...recipient...');
  
  // 1.1: Create base transaction request
  const request = new ScriptTransactionRequest();
  
  // 1.2: Add predicate resources (inputs)
  const resources = await predicate.getResourcesToSpend([
    {
      amount: amountToSend,
      assetId: await provider.getBaseAssetId(),
    },
  ]);
  request.addResources(resources);
  
  // 1.3: Add transaction outputs
  request.addCoinOutput(
    recipientAddress,
    amountToSend,
    await provider.getBaseAssetId()
  );
  request.addChangeOutput(
    predicate.address,
    await provider.getBaseAssetId()
  );
  
  // 1.4: Add placeholder witness
  const placeholderWitness = new Uint8Array(64).fill(0);
  const witnessIndex = request.witnesses.length;
  request.witnesses.push(placeholderWitness);
  
  // 1.5: Link witness to predicate inputs
  request.inputs.forEach((input) => {
    if ('predicate' in input && input.predicate) {
      input.witnessIndex = witnessIndex;
    }
  });
  
  // ===== PHASE 2: ESTIMATE TRANSACTION COST (BEFORE SIGNING!) =====
  
  // 2.1: Calculate transaction cost WITH PLACEHOLDER
  const txCost = await predicate.getTransactionCost(request);
  
  // 2.2: Set gas parameters on the request
  request.gasLimit = txCost.gasUsed;
  request.maxFee = txCost.maxFee;
  
  console.log('💰 Transaction cost (before signing):');
  console.log('  Gas used:', txCost.gasUsed.toString());
  console.log('  Max fee:', txCost.maxFee.toString());
  
  // ===== PHASE 3: CALCULATE TRANSACTION ID AND SIGN =====
  
  // 3.1: Get the chain ID
  const chainId = await provider.getChainId();
  
  // 3.2: Calculate the transaction ID
  const txId = request.getTransactionId(chainId);
  console.log('🔗 Transaction ID (with placeholder and correct gas):', txId);
  
  // 3.3: Sign the transaction ID using EIP-191 Personal Sign
  const txIdString = txId.slice(2); // Remove '0x' prefix
  
  // Using ethers.js:
  // const signature = await evmWallet.signMessage(txIdString);
  
  // Using viem (via custom EIP1193Provider):
  const signature = (await evmProvider.request({
    method: 'eth_sign',
    params: [evmAccount.address, txId as `0x${string}`],
  })) as string;
  
  console.log('🔏 Signature received:', signature);
  
  // 3.4: Convert signature to compact format
  const compactSig = toCompactSignature(signature);
  const compactBytes = new Uint8Array(
    compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );
  
  console.log('✅ Compact signature bytes:', compactBytes.length, '(should be 64)');
  
  // 3.5: Replace the placeholder witness with real signature
  request.witnesses[witnessIndex] = compactBytes;
  
  // ===== PHASE 4: ESTIMATE PREDICATES (WITH REAL SIGNATURE) =====
  
  // 4.1: Call provider.estimatePredicates with real signature
  console.log('🔬 Estimating predicates...');
  const estimated = await provider.estimatePredicates(request);
  console.log('Gas estimated:', estimated.inputs[0].predicateGasUsed);
  
  // 4.3: Verify the transaction ID hasn't changed
  const finalTxId = estimated.getTransactionId(chainId);
  console.log('🔗 Final Transaction ID:', finalTxId);
  console.log('📊 TxID match:', txId === finalTxId); // Should be TRUE
  
  if (txId !== finalTxId) {
    throw new Error('Transaction ID changed after signing! Signature is now invalid.');
  }
  
  // ===== PHASE 5: SUBMIT TRANSACTION =====
  
  // 5.1: Send the transaction to the network
  console.log('🚀 Sending transaction...');
  const { waitForResult } = await provider.sendTransaction(estimated, {
    estimateTxDependencies: false, // We already estimated predicates
  });
  
  // 5.2: Wait for transaction to be included in a block
  const result = await waitForResult();
  
  console.log('✅ Transaction succeeded!');
  console.log('Transaction ID:', result.id);
  console.log('Status:', result.status);
  
  // Verify recipient received funds
  const balance = await provider.getBalance(
    recipientAddress,
    await provider.getBaseAssetId()
  );
  console.log('Recipient balance:', balance.toString());
  
  return result;
}

/**
 * ============================================================================
 * KEY TAKEAWAYS
 * ============================================================================
 * 
 * 1. ORDER MATTERS: Always estimate gas BEFORE signing
 * 2. PLACEHOLDER IS REQUIRED: Must be present for correct witness count
 * 3. GAS PARAMS ARE PART OF TXID: gasLimit and maxFee affect the hash
 * 4. WITNESSES DON'T CHANGE TXID: You can replace witness data safely
 * 5. ESTIMATE PREDICATES LAST: Do this after replacing placeholder with real sig
 * 6. EIP-191 SIGNS UTF-8: The hex string is converted to UTF-8, not raw bytes
 * 7. COMPACT FORMAT REQUIRED: Fuel predicates expect 64-byte compact signatures
 * 8. VERIFY TXID MATCH: Always check that txId didn't change after modifications
 * 
 * Follow this exact order and your predicate transactions will work every time!
 */



/**
 * EIP-191 Predicate Witness Transaction Test (Using SDK Setup Pattern)
 * 
 * This test demonstrates the complete flow for spending from a predicate that validates
 * EIP-191 signatures against an EVM address, using the same setup patterns as wallet-sdk.
 * 
 * 1. SETUP PHASE:
 *    - Create EVM account and provider from private key
 *    - Create Fuel funding wallet from private key
 *    - Load predicate with EVM address configurable
 * 
 * 2. PLACEHOLDER PHASE:
 *    - Build transaction with predicate inputs
 *    - Add a 64-byte placeholder witness (all zeros)
 *    - Set witnessIndex on predicate inputs
 * 
 * 3. SIGNING PHASE:
 *    - Calculate transaction ID WITH placeholder
 *    - Sign using evmProvider.request({ method: 'eth_sign' })
 *    - This produces a 65-byte Ethereum signature (r + s + v)
 * 
 * 4. CONVERSION PHASE:
 *    - Convert to 64-byte compact format
 *    - Replace placeholder with real signature
 * 
 * 5. ESTIMATION PHASE:
 *    - Call estimatePredicates() with real signature
 *    - Network calculates exact gas needed
 * 
 * 6. SUBMISSION PHASE:
 *    - Send with estimateTxDependencies: false
 *    - Predicate validates using ec_recover_evm_address
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { bn, ScriptTransactionRequest, Address } from 'fuels';
import { SimplePredicateTestContext } from './utils/setup.js';
import { loadPredicate, fundPredicate } from '../src/index.js';
import { toCompactSignature } from '../src/utils/signatureUtils.js';

describe('Simple Predicate with SDK Setup Pattern', () => {
  let ctx: SimplePredicateTestContext;
  let predicate: any;

  beforeAll(async () => {
    // Create test context
    ctx = await SimplePredicateTestContext.create();

    // Load predicate with EVM address
    predicate = await loadPredicate(ctx.provider, ctx.evmAccount.address);
    console.log('Predicate Address:', predicate.address.toString());

    // Fund predicate
    await fundPredicate(ctx.fundingWallet, predicate, '1000000');
  });

  it('should successfully spend from predicate with EIP-191 signature', async () => {
    const amountToSend = bn(1234);
    const recipientAddress = Address.fromString('0x0000000000000000000000000000000000000000000000000000000000000012');

    // Build transaction request
    const request = new ScriptTransactionRequest();

    // Add predicate input
    const resources = await predicate.getResourcesToSpend([
      {
        amount: amountToSend,
        assetId: await ctx.provider.getBaseAssetId(),
      },
    ]);

    request.addResources(resources);

    // Add outputs
    request.addCoinOutput(
      recipientAddress,
      amountToSend,
      await ctx.provider.getBaseAssetId()
    );

    request.addChangeOutput(
      predicate.address,
      await ctx.provider.getBaseAssetId()
    );

    // Add placeholder witness
    const placeholderWitness = new Uint8Array(64).fill(0);
    const witnessIndex = request.witnesses.length;
    request.witnesses.push(placeholderWitness);

    // Set witness index on predicate inputs
    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });

    // CRITICAL: Estimate transaction cost BEFORE signing
    // This sets the correct gasLimit and maxFee
    const txCost = await predicate.getTransactionCost(request);
    request.gasLimit = txCost.gasUsed;
    request.maxFee = txCost.maxFee;

    console.log('\n💰 Transaction cost (before signing):');
    console.log('  Gas used:', txCost.gasUsed.toString());
    console.log('  Max fee:', txCost.maxFee.toString());

    // NOW calculate transaction ID with correct gas parameters
    const chainId = await ctx.provider.getChainId();
    const txId = request.getTransactionId(chainId);
    console.log('\n🔗 Transaction ID (with placeholder and correct gas):', txId);

    // Sign with EVM provider
    const signature = (await ctx.evmProvider.request({
      method: 'eth_sign',
      params: [ctx.evmAccount.address, txId as `0x${string}`],
    })) as string;

    console.log('🔏 Signature received:', signature);

    // Convert to compact format
    const compactSig = toCompactSignature(signature);
    const compactBytes = new Uint8Array(
      compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    console.log('✅ Compact signature bytes:', compactBytes.length, '(should be 64)');

    // Replace placeholder with real signature
    request.witnesses[witnessIndex] = compactBytes;

    // Estimate predicates with real signature (this doesn't change txId)
    console.log('\n🔬 Estimating predicates...');
    const estimated = await ctx.provider.estimatePredicates(request);
    console.log('Gas estimated:', estimated.inputs[0].predicateGasUsed);

    // Verify txId hasn't changed
    const finalTxId = estimated.getTransactionId(chainId);
    console.log('🔗 Final Transaction ID:', finalTxId);
    console.log('📊 TxID match:', txId === finalTxId);


      console.log('\n📋 Complete Transaction Object before network send:');
    console.log(JSON.stringify(estimated, null, 2));


    // Send transaction
    console.log('\n🚀 Sending transaction...');
    const { waitForResult } = await ctx.provider.sendTransaction(estimated, {
      estimateTxDependencies: false,
    });

    const result = await waitForResult();

    console.log('✅ Transaction succeeded!');
    console.log('Transaction ID:', result.id);
    console.log('Status:', result.status);

    expect(result.status).toBe('success');

    // Verify recipient received funds
    const balance = await ctx.provider.getBalance(
      recipientAddress,
      await ctx.provider.getBaseAssetId()
    );
    expect(balance.toNumber()).toBe(1234);
  });
});