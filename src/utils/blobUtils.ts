/**
 * Blob Utilities for Fuel Predicates
 * 
 * This module provides utilities for working with blob-based predicates:
 * - Calculate BlobID from full predicate bytecode
 * - Verify loader predicates contain correct BlobID
 * - Parse loader structure
 */

import { sha256 } from 'fuels';

// Loader bytecode structure:
// [48 bytes: instructions] + [32 bytes: blobId] + [8 bytes: section_length] + [N bytes: configurables]
const LOADER_INSTRUCTIONS_LENGTH = 48;
const BLOB_ID_LENGTH = 32;
const SECTION_LENGTH_SIZE = 8;

export interface LoaderComponents {
  instructions: Uint8Array;
  blobId: Uint8Array;
  sectionLength: bigint;
  configurables: Uint8Array;
}

/**
 * Get the offset where configurables section starts in predicate bytecode
 */
export function getConfigurablesSectionOffset(abi: any): number {
  if (!abi.configurables || abi.configurables.length === 0) {
    throw new Error('No configurables found in ABI');
  }
  
  // Find the minimum offset (configurables section starts at lowest offset)
  const minOffset = Math.min(
    ...abi.configurables.map((c: any) => c.offset)
  );
  
  return minOffset;
}

/**
 * Split predicate bytecode into code section and configurables section
 */
export function splitPredicateBytecode(
  bytecode: Uint8Array,
  abi: any
): { codeSection: Uint8Array; configurablesSection: Uint8Array } {
  const configurablesOffset = getConfigurablesSectionOffset(abi);
  
  const codeSection = bytecode.slice(0, configurablesOffset);
  const configurablesSection = bytecode.slice(configurablesOffset);
  
  return { codeSection, configurablesSection };
}

/**
 * Calculate BlobID from predicate bytecode
 * BlobID = SHA256(code_section_only)
 */
export function calculateBlobId(bytecode: Uint8Array, abi: any): string {
  const { codeSection } = splitPredicateBytecode(bytecode, abi);
  
  // Hash only the code section (excludes configurables)
  const hash = sha256(codeSection);
  
  return hash;
}

/**
 * Parse loader bytecode structure
 */
export function parseLoaderStructure(
  loaderBytecode: Uint8Array
): LoaderComponents | null {
  const minLength = LOADER_INSTRUCTIONS_LENGTH + BLOB_ID_LENGTH + SECTION_LENGTH_SIZE;
  
  if (loaderBytecode.length < minLength) {
    return null;
  }
  
  let offset = 0;
  
  // Extract instructions (48 bytes)
  const instructions = loaderBytecode.slice(offset, offset + LOADER_INSTRUCTIONS_LENGTH);
  offset += LOADER_INSTRUCTIONS_LENGTH;
  
  // Extract blob ID (32 bytes)
  const blobId = loaderBytecode.slice(offset, offset + BLOB_ID_LENGTH);
  offset += BLOB_ID_LENGTH;
  
  // Extract section length (8 bytes, big-endian u64)
  const sectionLengthBytes = loaderBytecode.slice(offset, offset + SECTION_LENGTH_SIZE);
  offset += SECTION_LENGTH_SIZE;
  
  // Convert 8 bytes to bigint (big-endian)
  const sectionLength = sectionLengthBytes.reduce(
    (acc, byte, i) => acc + BigInt(byte) * (256n ** BigInt(7 - i)),
    0n
  );
  
  // Extract configurables (remaining bytes)
  const configurables = loaderBytecode.slice(offset);
  
  return {
    instructions,
    blobId,
    sectionLength,
    configurables,
  };
}

/**
 * Verify that a loader predicate contains the correct BlobID
 */
export function verifyLoaderBlobId(
  fullBytecode: Uint8Array,
  fullAbi: any,
  loaderBytecode: Uint8Array
): boolean {
  // Calculate expected blob ID from full predicate
  const expectedBlobId = calculateBlobId(fullBytecode, fullAbi);
  
  // Parse loader to extract embedded blob ID
  const loaderComponents = parseLoaderStructure(loaderBytecode);
  
  if (!loaderComponents) {
    return false;
  }
  
  // Convert embedded blob ID to hex string
  const embeddedBlobId = '0x' + Array.from(loaderComponents.blobId)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return embeddedBlobId === expectedBlobId;
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }
  
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}