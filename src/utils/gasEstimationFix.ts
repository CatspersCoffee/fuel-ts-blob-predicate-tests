/**
 * Gas Estimation Fix for Blob-Based Predicates
 * 
 * This module fixes the gas estimation issues with the Fuel SDK v0.101.2
 * when working with blob-based predicates and fuel-core v0.46.0
 */

import {
  Provider,
  ScriptTransactionRequest,
  bn,
  BN,
} from 'fuels';

/**
 * Fix gas parameters after estimatePredicates clears them
 */
export async function estimateAndFixGasParameters(
  provider: Provider,
  request: ScriptTransactionRequest
): Promise<ScriptTransactionRequest> {
  // Store original gas parameters BEFORE estimation
  const originalGasLimit = request.gasLimit;
  const originalMaxFee = request.maxFeePerGas || bn(1);
  
  console.log('\n📊 Pre-estimation gas parameters:');
  console.log('  Original gasLimit:', originalGasLimit?.toString());
  console.log('  Original maxFeePerGas:', originalMaxFee?.toString());
  
  // Call estimatePredicates
  const estimated = await provider.estimatePredicates(request);
  
  console.log('\n📊 Post-estimation (raw) gas parameters:');
  console.log('  Estimated gasLimit:', estimated.gasLimit?.toString());
  console.log('  Estimated maxFeePerGas:', estimated.maxFeePerGas?.toString());
  console.log('  Estimated witnessLimit:', estimated.witnessLimit?.toString());
  
  // CRITICAL FIX: Ensure maxFeePerGas is properly set
  // The issue is that estimatePredicates returns a new object without some fields
  if (!estimated.maxFeePerGas || estimated.maxFeePerGas.eq(0)) {
    // Use the original value or a minimum of 1
    estimated.maxFeePerGas = BN.max(originalMaxFee, bn(1));
    console.log('  ✅ Fixed maxFeePerGas to:', estimated.maxFeePerGas.toString());
  }
  
  // Ensure gasLimit is reasonable
  if (!estimated.gasLimit || estimated.gasLimit.eq(0)) {
    // Use original or a safe default
    estimated.gasLimit = originalGasLimit || bn(100000);
    console.log('  ✅ Fixed gasLimit to:', estimated.gasLimit.toString());
  }
  
  // Set witness limit if not present
  if (!estimated.witnessLimit) {
    // Calculate based on witness size
    const totalWitnessSize = estimated.witnesses.reduce(
      (sum, witness) => sum + witness.length,
      0
    );
    estimated.witnessLimit = bn(Math.max(totalWitnessSize * 2, 10000));
    console.log('  ✅ Set witnessLimit to:', estimated.witnessLimit.toString());
  }
  
  // Add a gas buffer for safety (20%)
  if (estimated.gasLimit) {
    const bufferedGasLimit = estimated.gasLimit.mul(120).div(100);
    estimated.gasLimit = bufferedGasLimit;
    console.log('  ✅ Added 20% gas buffer, final gasLimit:', estimated.gasLimit.toString());
  }
  
  console.log('\n📊 Final fixed gas parameters:');
  console.log('  gasLimit:', estimated.gasLimit?.toString());
  console.log('  maxFeePerGas:', estimated.maxFeePerGas?.toString());
  console.log('  witnessLimit:', estimated.witnessLimit?.toString());
  
  // Double-check that predicateGasUsed was calculated
  if (estimated.inputs && estimated.inputs[0]) {
    console.log('  predicateGasUsed:', estimated.inputs[0].predicateGasUsed?.toString());
  }
  
  return estimated;
}

/**
 * Alternative approach: Build a new transaction request with proper gas settings
 */
export async function buildFixedTransactionRequest(
  provider: Provider,
  estimatedRequest: ScriptTransactionRequest,
  originalMaxFee?: BN
): Promise<ScriptTransactionRequest> {
  // Create a new transaction request with all the estimated values
  const fixedRequest = new ScriptTransactionRequest({
    gasLimit: estimatedRequest.gasLimit || bn(100000),
    maxFeePerGas: originalMaxFee || bn(1),
    witnessLimit: estimatedRequest.witnessLimit || bn(10000),
    maturity: estimatedRequest.maturity,
    script: estimatedRequest.script,
    scriptData: estimatedRequest.scriptData,
  });
  
  // Copy inputs with predicate gas
  estimatedRequest.inputs.forEach((input, index) => {
    fixedRequest.inputs[index] = { ...input };
  });
  
  // Copy outputs
  estimatedRequest.outputs.forEach((output, index) => {
    fixedRequest.outputs[index] = { ...output };
  });
  
  // Copy witnesses
  estimatedRequest.witnesses.forEach((witness, index) => {
    fixedRequest.witnesses[index] = witness;
  });
  
  return fixedRequest;
}

/**
 * Debug function to inspect transaction structure
 */
export function debugTransactionRequest(request: ScriptTransactionRequest, label: string = 'Transaction') {
  console.log(`\n🔍 ${label} Debug Info:`);
  console.log('  Type:', request.constructor.name);
  console.log('  Has gasLimit:', !!request.gasLimit);
  console.log('  gasLimit value:', request.gasLimit?.toString());
  console.log('  Has maxFeePerGas:', !!request.maxFeePerGas);
  console.log('  maxFeePerGas value:', request.maxFeePerGas?.toString());
  console.log('  Has witnessLimit:', !!request.witnessLimit);
  console.log('  witnessLimit value:', request.witnessLimit?.toString());
  console.log('  Inputs count:', request.inputs.length);
  console.log('  Outputs count:', request.outputs.length);
  console.log('  Witnesses count:', request.witnesses.length);
  
  // Check predicate gas on inputs
  request.inputs.forEach((input, idx) => {
    if ('predicateGasUsed' in input) {
      console.log(`  Input[${idx}] predicateGasUsed:`, input.predicateGasUsed?.toString());
    }
  });
  
  // Log the actual object structure
  console.log('\n  Raw object keys:', Object.keys(request));
  
  // Check if it's properly formatted for sending
  try {
    const chainId = 0; // Use the chainId from your test
    const txId = request.getTransactionId(chainId);
    console.log('  ✅ Can calculate transaction ID:', txId);
  } catch (error: any) {
    console.log('  ❌ Cannot calculate transaction ID:', error.message);
  }
}

/**
 * Complete solution for the blob predicate gas estimation issue
 */
export async function executeWithFixedGasEstimation(
  provider: Provider,
  request: ScriptTransactionRequest
): Promise<any> {
  console.log('\n' + '='.repeat(80));
  console.log('FIXED GAS ESTIMATION FLOW');
  console.log('='.repeat(80));
  
  // Debug initial state
  debugTransactionRequest(request, 'Initial Request');
  
  // Estimate with fixes
  const estimated = await estimateAndFixGasParameters(provider, request);
  
  // Debug estimated state
  debugTransactionRequest(estimated, 'After Estimation & Fixes');
  
  // Ensure the transaction is properly formatted
  if (!estimated.maxFeePerGas || estimated.maxFeePerGas.eq(0)) {
    throw new Error('maxFeePerGas is still 0 after fixes - transaction will fail');
  }
  
  // Send transaction
  console.log('\n🚀 Sending transaction with fixed gas parameters...');
  const { waitForResult } = await provider.sendTransaction(estimated, {
    estimateTxDependencies: false,
  });
  
  return waitForResult();
}