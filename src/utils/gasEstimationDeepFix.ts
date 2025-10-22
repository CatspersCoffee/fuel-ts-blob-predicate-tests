/**
 * Deep Fix for Gas Estimation Issues with Blob Predicates
 * 
 * This module provides a more aggressive approach to fixing the gas estimation
 * problem by rebuilding the transaction request completely.
 */

import {
  Provider,
  ScriptTransactionRequest,
  bn,
  BN,
  TransactionRequest,
} from 'fuels';

/**
 * Completely rebuild the transaction request to ensure all gas parameters are properly set
 */
export async function rebuildTransactionWithGas(
  provider: Provider,
  estimatedRequest: ScriptTransactionRequest,
  originalMaxFee: BN = bn(1)
): Promise<ScriptTransactionRequest> {
  console.log('\n🔨 Rebuilding transaction with proper gas parameters...');
  
  // Create a completely new transaction request
  const rebuilt = new ScriptTransactionRequest({
    script: estimatedRequest.script || new Uint8Array(),
    scriptData: estimatedRequest.scriptData || new Uint8Array(),
    maturity: estimatedRequest.maturity,
  });
  
  // CRITICAL: Set gas parameters FIRST, before anything else
  rebuilt.gasLimit = estimatedRequest.gasLimit || bn(200000);
  rebuilt.maxFeePerGas = originalMaxFee;
  rebuilt.witnessLimit = estimatedRequest.witnessLimit || bn(10000);
  
  console.log('  Set gas parameters:');
  console.log('    gasLimit:', rebuilt.gasLimit.toString());
  console.log('    maxFeePerGas:', rebuilt.maxFeePerGas.toString());
  console.log('    witnessLimit:', rebuilt.witnessLimit?.toString());
  
  // Copy inputs with predicate gas
  estimatedRequest.inputs.forEach((input) => {
    rebuilt.inputs.push({ ...input });
  });
  console.log('  Copied', rebuilt.inputs.length, 'inputs');
  
  // Copy outputs
  estimatedRequest.outputs.forEach((output) => {
    rebuilt.outputs.push({ ...output });
  });
  console.log('  Copied', rebuilt.outputs.length, 'outputs');
  
  // Copy witnesses
  estimatedRequest.witnesses.forEach((witness) => {
    rebuilt.witnesses.push(witness);
  });
  console.log('  Copied', rebuilt.witnesses.length, 'witnesses');
  
  // Verify the gas parameters are still set
  console.log('\n  Verification after rebuild:');
  console.log('    gasLimit:', rebuilt.gasLimit?.toString());
  console.log('    maxFeePerGas:', rebuilt.maxFeePerGas?.toString());
  console.log('    witnessLimit:', rebuilt.witnessLimit?.toString());
  
  return rebuilt;
}

/**
 * Alternative: Use transaction request methods to ensure gas is set
 */
export async function forceSetGasParameters(
  request: ScriptTransactionRequest,
  gasLimit: BN,
  maxFeePerGas: BN,
  witnessLimit: BN
): ScriptTransactionRequest {
  console.log('\n⚡ Force-setting gas parameters...');
  
  // Use Object.defineProperty to ensure the properties stick
  Object.defineProperty(request, 'gasLimit', {
    value: gasLimit,
    writable: true,
    enumerable: true,
    configurable: true
  });
  
  Object.defineProperty(request, 'maxFeePerGas', {
    value: maxFeePerGas,
    writable: true,
    enumerable: true,
    configurable: true
  });
  
  Object.defineProperty(request, 'witnessLimit', {
    value: witnessLimit,
    writable: true,
    enumerable: true,
    configurable: true
  });
  
  console.log('  Force-set values:');
  console.log('    gasLimit:', request.gasLimit?.toString());
  console.log('    maxFeePerGas:', request.maxFeePerGas?.toString());
  console.log('    witnessLimit:', request.witnessLimit?.toString());
  
  return request;
}

/**
 * Complete workflow with multiple fallback strategies
 */
export async function estimateWithFallbacks(
  provider: Provider,
  request: ScriptTransactionRequest
): Promise<ScriptTransactionRequest> {
  console.log('\n' + '='.repeat(80));
  console.log('MULTI-STRATEGY GAS ESTIMATION');
  console.log('='.repeat(80));
  
  // Store original values
  const originalMaxFee = request.maxFeePerGas || bn(1);
  const originalGasLimit = request.gasLimit || bn(200000);
  
  // Strategy 1: Try normal estimation
  console.log('\n📊 Strategy 1: Normal estimation...');
  let estimated = await provider.estimatePredicates(request);
  
  // Check if gas parameters are missing
  if (!estimated.maxFeePerGas || estimated.maxFeePerGas.eq(0)) {
    console.log('  ⚠️  maxFeePerGas is missing/zero, trying Strategy 2...');
    
    // Strategy 2: Rebuild the transaction
    console.log('\n📊 Strategy 2: Rebuild transaction...');
    estimated = await rebuildTransactionWithGas(provider, estimated, originalMaxFee);
    
    // If still not working, try Strategy 3
    if (!estimated.maxFeePerGas || estimated.maxFeePerGas.eq(0)) {
      console.log('  ⚠️  Still missing, trying Strategy 3...');
      
      // Strategy 3: Force set with Object.defineProperty
      console.log('\n📊 Strategy 3: Force set properties...');
      estimated = await forceSetGasParameters(
        estimated,
        estimated.gasLimit || originalGasLimit,
        originalMaxFee,
        estimated.witnessLimit || bn(10000)
      );
    }
  }
  
  // Final validation
  console.log('\n✅ Final gas parameters:');
  console.log('  gasLimit:', estimated.gasLimit?.toString());
  console.log('  maxFeePerGas:', estimated.maxFeePerGas?.toString());
  console.log('  witnessLimit:', estimated.witnessLimit?.toString());
  
  if (!estimated.maxFeePerGas || estimated.maxFeePerGas.eq(0)) {
    throw new Error('CRITICAL: Unable to set maxFeePerGas - all strategies failed');
  }
  
  return estimated;
}

/**
 * Direct transaction creation bypassing estimation
 */
export async function createDirectTransaction(
  provider: Provider,
  request: ScriptTransactionRequest,
  predicateGasUsed: BN
): Promise<ScriptTransactionRequest> {
  console.log('\n🚀 Creating direct transaction (bypassing estimation issues)...');
  
  // Calculate total gas needed
  const baseGas = bn(50000); // Base transaction gas
  const totalGas = baseGas.add(predicateGasUsed).mul(120).div(100); // Add 20% buffer
  
  // Create new request with explicit gas settings
  const direct = new ScriptTransactionRequest({
    gasLimit: totalGas,
    maxFeePerGas: bn(1),
    witnessLimit: bn(10000),
    script: request.script || new Uint8Array(),
    scriptData: request.scriptData || new Uint8Array(),
  });
  
  // Copy all inputs, outputs, witnesses
  request.inputs.forEach((input, idx) => {
    // Set predicate gas on inputs
    if ('predicateGasUsed' in input) {
      direct.inputs[idx] = {
        ...input,
        predicateGasUsed: predicateGasUsed,
      };
    } else {
      direct.inputs[idx] = { ...input };
    }
  });
  
  request.outputs.forEach((output, idx) => {
    direct.outputs[idx] = { ...output };
  });
  
  request.witnesses.forEach((witness, idx) => {
    direct.witnesses[idx] = witness;
  });
  
  console.log('  Direct transaction created:');
  console.log('    gasLimit:', direct.gasLimit.toString());
  console.log('    maxFeePerGas:', direct.maxFeePerGas.toString());
  console.log('    witnessLimit:', direct.witnessLimit.toString());
  console.log('    predicateGasUsed:', predicateGasUsed.toString());
  
  return direct;
}

/**
 * Debug helper to inspect the actual transaction bytes
 */
export function debugTransactionBytes(request: ScriptTransactionRequest, chainId: number) {
  console.log('\n🔬 Transaction Bytes Debug:');
  
  try {
    // Try to get the transaction ID (this validates the structure)
    const txId = request.getTransactionId(chainId);
    console.log('  Transaction ID:', txId);
    
    // Check the transaction request type
    console.log('  Request type:', request.type);
    
    // Try to access internal properties
    const anyRequest = request as any;
    
    // Log internal structure
    if (anyRequest.gasPrice !== undefined) {
      console.log('  Internal gasPrice:', anyRequest.gasPrice?.toString());
    }
    if (anyRequest.maxFeePerGas !== undefined) {
      console.log('  Internal maxFeePerGas:', anyRequest.maxFeePerGas?.toString());
    }
    if (anyRequest.gasLimit !== undefined) {
      console.log('  Internal gasLimit:', anyRequest.gasLimit?.toString());
    }
    
    // Check if toTransaction method exists
    if (typeof anyRequest.toTransaction === 'function') {
      const tx = anyRequest.toTransaction();
      console.log('  Transaction object keys:', Object.keys(tx));
      console.log('  Transaction gasLimit:', tx.gasLimit?.toString());
      console.log('  Transaction gasPrice:', tx.gasPrice?.toString());
      console.log('  Transaction maxFeePerGas:', tx.maxFeePerGas?.toString());
    }
    
  } catch (error: any) {
    console.log('  ❌ Error in transaction debug:', error.message);
  }
}