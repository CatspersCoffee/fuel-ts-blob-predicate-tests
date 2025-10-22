/**
 * Blob Deployment Utilities
 * 
 * This module provides utilities for deploying predicates as blobs to the Fuel network
 */

import { Account, Predicate, Provider } from 'fuels';
import { calculateBlobId } from './blobUtils';

export interface BlobDeploymentResult {
  blobId: string;
  transactionId: string;
  status: 'success' | 'already_deployed';
}

/**
 * Deploy a predicate as a blob to the network
 */
/*
export async function deployPredicateBlob(
  predicate: Predicate<any, any>,
  account: Account
): Promise<BlobDeploymentResult> {
  try {
    // Get the predicate class to access static properties
    const PredicateClass = predicate.constructor as any;
    
    // Calculate blob ID
    const blobId = calculateBlobId(PredicateClass.bytecode, PredicateClass.abi);
    
    console.log(`Deploying predicate blob...`);
    console.log(`  BlobID: ${blobId}`);
    console.log(`  Bytecode size: ${PredicateClass.bytecode.length} bytes`);
    
    // Deploy the blob (same as in the zap project)
    const { waitForResult, blobId: deploymentBlobId } = await predicate.deploy(account);
    const result = await waitForResult();
    
    // Verify blob ID matches
    if (deploymentBlobId !== blobId) {
      console.warn(`⚠️  BlobID mismatch!`);
      console.warn(`  Calculated: ${blobId}`);
      console.warn(`  Deployed:   ${deploymentBlobId}`);
    }
    
    console.log(`✅ Blob deployed successfully`);
    console.log(`  Transaction ID: ${result.id}`);
    
    return {
      blobId: deploymentBlobId,
      transactionId: result.id,
      status: 'success',
    };
  } catch (error: any) {
    // Handle "BlobIdAlreadyUploaded" as success
    if (error?.rawError?.message?.includes('BlobIdAlreadyUploaded')) {
      const PredicateClass = predicate.constructor as any;
      const blobId = calculateBlobId(PredicateClass.bytecode, PredicateClass.abi);
      
      console.log(`ℹ️  Blob already deployed`);
      console.log(`  BlobID: ${blobId}`);
      
      return {
        blobId,
        transactionId: '',
        status: 'already_deployed',
      };
    }
    
    // Re-throw other errors
    throw error;
  }
}
*/
/**
 * Deploy a predicate as a blob to the network
 */
// DEBUG
export async function deployPredicateBlob(
  predicate: Predicate<any, any>,
  account: Account
): Promise<BlobDeploymentResult> {
  try {
    // Get the predicate class to access static properties
    const PredicateClass = predicate.constructor as any;
    
    // Calculate blob ID
    const blobId = calculateBlobId(PredicateClass.bytecode, PredicateClass.abi);
    
    console.log(`Deploying predicate blob...`);
    console.log(`  BlobID: ${blobId}`);
    console.log(`  Bytecode size: ${PredicateClass.bytecode.length} bytes`);
    console.log(`  Deploying wallet address: ${account.address.toString()}`);
    
    // Check wallet balance
    const provider = account.provider;
    const baseAssetId = await provider.getBaseAssetId();
    const balance = await account.getBalance(baseAssetId);
    console.log(`  Deploying wallet balance: ${balance.toString()} units`);
    
    // Verify we're deploying the FULL predicate, not the loader
    console.log(`  Predicate type: ${PredicateClass.name}`);
    console.log(`  Is this 'Simple' (full predicate)? ${PredicateClass.name === 'Simple' ? '✅ Yes' : '❌ No - Wrong class!'}`);
    
    // Deploy the blob (same as in the zap project)
    const { waitForResult, blobId: deploymentBlobId } = await predicate.deploy(account);
    const result = await waitForResult();
    
    // Verify blob ID matches
    if (deploymentBlobId !== blobId) {
      console.warn(`⚠️  BlobID mismatch!`);
      console.warn(`  Calculated: ${blobId}`);
      console.warn(`  Deployed:   ${deploymentBlobId}`);
    }
    
    console.log(`✅ Blob deployed successfully`);
    console.log(`  Transaction ID: ${result.id}`);
    
    return {
      blobId: deploymentBlobId,
      transactionId: result.id,
      status: 'success',
    };
  } catch (error: any) {
    // Handle "BlobIdAlreadyUploaded" as success
    if (error?.rawError?.message?.includes('BlobIdAlreadyUploaded')) {
      const PredicateClass = predicate.constructor as any;
      const blobId = calculateBlobId(PredicateClass.bytecode, PredicateClass.abi);
      
      console.log(`ℹ️  Blob already deployed`);
      console.log(`  BlobID: ${blobId}`);
      
      return {
        blobId,
        transactionId: '',
        status: 'already_deployed',
      };
    }
    
    // Re-throw other errors
    throw error;
  }
}


/**
 * Check if a blob is already deployed (by attempting to fetch it)
 * Note: This is a best-effort check; the definitive way is to try deploying
 */
export async function isBlobDeployed(
  provider: Provider,
  blobId: string
): Promise<boolean> {
  try {
    // For now, we assume blobs need to be deployed
    // In the future, this could query the provider for blob existence
    return false;
  } catch (error) {
    console.warn(`Error checking blob deployment status: ${error}`);
    return false;
  }
}

/**
 * Deploy a predicate blob if it hasn't been deployed yet
 */
export async function ensureBlobDeployed(
  predicate: Predicate<any, any>,
  account: Account
): Promise<BlobDeploymentResult> {
  const PredicateClass = predicate.constructor as any;
  const blobId = calculateBlobId(PredicateClass.bytecode, PredicateClass.abi);
  
  // Check if already deployed
  const isDeployed = await isBlobDeployed(account.provider, blobId);
  
  if (isDeployed) {
    console.log(`Blob ${blobId} is already deployed`);
    return {
      blobId,
      transactionId: '',
      status: 'already_deployed',
    };
  }
  
  // Deploy the blob
  return deployPredicateBlob(predicate, account);
}