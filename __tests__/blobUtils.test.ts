import { describe, it, expect } from 'vitest';
import { Simple } from '../src/generated/predicates/Simple';
import { SimpleLoader } from '../src/generated/predicates/SimpleLoader';
import {
  calculateBlobId,
  verifyLoaderBlobId,
  parseLoaderStructure,
  getConfigurablesSectionOffset,
  splitPredicateBytecode,
  bytesToHex,
} from '../src/utils/blobUtils';

describe('Blob Utilities', () => {
  describe('calculateBlobId', () => {
    it('should calculate BlobID from Simple predicate', () => {
      const blobId = calculateBlobId(Simple.bytecode, Simple.abi);
      
      expect(blobId).toBeTruthy();
      expect(blobId.startsWith('0x')).toBe(true);
      expect(blobId.length).toBe(66); // '0x' + 64 hex chars (32 bytes)
      
      console.log('Simple BlobID:', blobId);
    });

    it('should be deterministic (same inputs produce same BlobID)', () => {
      const blobId1 = calculateBlobId(Simple.bytecode, Simple.abi);
      const blobId2 = calculateBlobId(Simple.bytecode, Simple.abi);
      
      expect(blobId1).toBe(blobId2);
    });
  });

  describe('getConfigurablesSectionOffset', () => {
    it('should find configurables section offset in Simple ABI', () => {
      const offset = getConfigurablesSectionOffset(Simple.abi);
      
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThan(Simple.bytecode.length);
      
      console.log('Configurables offset:', offset);
    });

    it('should throw error if no configurables in ABI', () => {
      const emptyAbi = { configurables: [] };
      
      expect(() => getConfigurablesSectionOffset(emptyAbi)).toThrow('No configurables found');
    });
  });

  describe('splitPredicateBytecode', () => {
    it('should split Simple bytecode into code and configurables sections', () => {
      const { codeSection, configurablesSection } = splitPredicateBytecode(
        Simple.bytecode,
        Simple.abi
      );
      
      expect(codeSection.length).toBeGreaterThan(0);
      expect(configurablesSection.length).toBeGreaterThan(0);
      expect(codeSection.length + configurablesSection.length).toBe(Simple.bytecode.length);
      
      console.log('Code section:', codeSection.length, 'bytes');
      console.log('Configurables section:', configurablesSection.length, 'bytes');
    });
  });

  describe('parseLoaderStructure', () => {
    it('should parse SimpleLoader bytecode structure', () => {
      const components = parseLoaderStructure(SimpleLoader.bytecode);
      
      expect(components).toBeTruthy();
      expect(components!.instructions.length).toBe(48);
      expect(components!.blobId.length).toBe(32);
      expect(components!.sectionLength).toBeGreaterThan(0n);
      expect(components!.configurables.length).toBeGreaterThan(0);
      
      console.log('\nLoader structure:');
      console.log('  Instructions:', components!.instructions.length, 'bytes');
      console.log('  BlobID:', bytesToHex(components!.blobId));
      console.log('  Section length:', components!.sectionLength.toString());
      console.log('  Configurables:', components!.configurables.length, 'bytes');
    });

    it('should return null for invalid loader bytecode', () => {
      const invalidBytecode = new Uint8Array(10); // Too short
      const components = parseLoaderStructure(invalidBytecode);
      
      expect(components).toBeNull();
    });

    it('should extract correct configurables section length', () => {
      const components = parseLoaderStructure(SimpleLoader.bytecode);
      const { configurablesSection } = splitPredicateBytecode(Simple.bytecode, Simple.abi);
      
      expect(components).toBeTruthy();
      expect(components!.sectionLength).toBe(BigInt(configurablesSection.length));
      expect(components!.configurables.length).toBe(configurablesSection.length);
    });
  });

  describe('verifyLoaderBlobId', () => {
    it('should verify SimpleLoader contains correct BlobID from Simple', () => {
      const isValid = verifyLoaderBlobId(
        Simple.bytecode,
        Simple.abi,
        SimpleLoader.bytecode
      );
      
      expect(isValid).toBe(true);
      
      console.log('\n✅ Loader verification passed');
    });

    it('should detect mismatched BlobIDs', () => {
      // Create fake loader with wrong blob ID
      const components = parseLoaderStructure(SimpleLoader.bytecode);
      const fakeBlobId = new Uint8Array(32).fill(0xFF);
      
      const fakeLoader = new Uint8Array([
        ...components!.instructions,
        ...fakeBlobId,
        ...new Uint8Array(8), // section length
        ...components!.configurables,
      ]);
      
      const isValid = verifyLoaderBlobId(
        Simple.bytecode,
        Simple.abi,
        fakeLoader
      );
      
      expect(isValid).toBe(false);
    });
  });

  describe('bytesToHex and hexToBytes', () => {
    it('should convert bytes to hex string', () => {
      const bytes = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF]);
      const hex = bytesToHex(bytes);
      
      expect(hex).toBe('0x0123456789abcdef');
    });

    it('should handle empty bytes', () => {
      const bytes = new Uint8Array(0);
      const hex = bytesToHex(bytes);
      
      expect(hex).toBe('0x');
    });
  });

  describe('Integration: Full workflow', () => {
    it('should complete full BlobID calculation and verification workflow', () => {
      console.log('\n' + '='.repeat(60));
      console.log('COMPLETE BLOB WORKFLOW TEST');
      console.log('='.repeat(60));
      
      // Step 1: Calculate BlobID from full predicate
      const blobId = calculateBlobId(Simple.bytecode, Simple.abi);
      console.log('\n1. Calculated BlobID:', blobId);
      
      // Step 2: Parse loader structure
      const loaderComponents = parseLoaderStructure(SimpleLoader.bytecode);
      expect(loaderComponents).toBeTruthy();
      console.log('\n2. Parsed loader structure:');
      console.log('   - Instructions:', loaderComponents!.instructions.length, 'bytes');
      console.log('   - Embedded BlobID:', bytesToHex(loaderComponents!.blobId));
      console.log('   - Section length:', loaderComponents!.sectionLength.toString());
      console.log('   - Configurables:', loaderComponents!.configurables.length, 'bytes');
      
      // Step 3: Verify BlobID matches
      const embeddedBlobId = bytesToHex(loaderComponents!.blobId);
      const matches = embeddedBlobId === blobId;
      console.log('\n3. BlobID verification:', matches ? '✅ Match' : '❌ Mismatch');
      console.log('   - Calculated:', blobId);
      console.log('   - Embedded:  ', embeddedBlobId);
      
      expect(matches).toBe(true);
      
      // Step 4: Verify using utility function
      const isValid = verifyLoaderBlobId(
        Simple.bytecode,
        Simple.abi,
        SimpleLoader.bytecode
      );
      console.log('\n4. Utility verification:', isValid ? '✅ Valid' : '❌ Invalid');
      
      expect(isValid).toBe(true);
      
      // Step 5: Size comparison
      const fullSize = Simple.bytecode.length;
      const loaderSize = SimpleLoader.bytecode.length;
      const reduction = ((1 - loaderSize / fullSize) * 100).toFixed(2);
      
      console.log('\n5. Size analysis:');
      console.log('   - Full predicate:', fullSize, 'bytes');
      console.log('   - Loader:', loaderSize, 'bytes');
      console.log('   - Reduction:', reduction + '%');
      
      console.log('\n' + '='.repeat(60) + '\n');
      
      expect(loaderSize).toBeLessThan(fullSize);
    });
  });
});