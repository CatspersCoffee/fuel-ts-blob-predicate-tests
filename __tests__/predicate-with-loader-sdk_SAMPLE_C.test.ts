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
  parseLoaderStructure,
  bytesToHex 
} from '../src/utils/blobUtils.js';
import { deployPredicateBlob } from '../src/utils/blobDeployment.js';

/**
 * Blob-Based Predicate Test with SDK Test Node
 * 
 * This test uses the Fuels SDK test node launcher instead of connecting to localhost.
 * This helps isolate whether the issue is with the local node or the code.
 */
describe('Simple Predicate with Blob Loader (SDK Provider)', () => {
  let provider: Provider;
  let cleanup: () => void;
  let fundingWallet: WalletUnlocked;
  let evmWallet: Wallet;
  let predicateLoader: SimpleLoader;
  let blobId: string;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('BLOB-BASED PREDICATE TEST SETUP (SDK PROVIDER)');
    console.log('='.repeat(80));

    // Launch test node with SDK
    const launched = await launchTestNode({
      walletsConfig: {
        count: 1,
        amountPerCoin: 10_000_000,
      },
    });

    provider = launched.provider;
    cleanup = launched.cleanup;
    fundingWallet = launched.wallets[0];

    console.log('✅ Test node launched');
    console.log('Provider URL:', provider.url);
    console.log('Funding Wallet Address:', fundingWallet.address.toString());

    // Check funding wallet balance
    const baseAssetId = await provider.getBaseAssetId();
    const balance = await fundingWallet.getBalance(baseAssetId);
    console.log('Funding Wallet Balance:', balance.toString(), 'units');

    // Create EVM wallet from private key (for signing)
    const evmPrivateKey = process.env.TEST_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
    evmWallet = new Wallet(evmPrivateKey);
    
    console.log('EVM Address:', evmWallet.address);

    // STEP 1: Calculate and verify BlobID
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 1: BlobID Calculation and Verification');
    console.log('-'.repeat(80));
    
    blobId = calculateBlobId(Simple.bytecode, Simple.abi);
    console.log('Calculated BlobID:', blobId);
    console.log('Full predicate size:', Simple.bytecode.length, 'bytes');
    console.log('Loader predicate size:', SimpleLoader.bytecode.length, 'bytes');
    
    const sizeReduction = ((1 - SimpleLoader.bytecode.length / Simple.bytecode.length) * 100).toFixed(1);
    console.log(`Size reduction: ${sizeReduction}%`);
    
    // Verify loader contains correct BlobID
    const isLoaderValid = verifyLoaderBlobId(
      Simple.bytecode,
      Simple.abi,
      SimpleLoader.bytecode
    );
    
    console.log('Loader verification:', isLoaderValid ? '✅ Valid' : '❌ Invalid');
    expect(isLoaderValid).toBe(true);
    
    // Parse and display loader structure
    const loaderComponents = parseLoaderStructure(SimpleLoader.bytecode);
    if (loaderComponents) {
      console.log('\nLoader structure:');
      console.log('  Instructions:', loaderComponents.instructions.length, 'bytes');
      console.log('  Embedded BlobID:', bytesToHex(loaderComponents.blobId));
      console.log('  Section length:', loaderComponents.sectionLength.toString());
      console.log('  Configurables:', loaderComponents.configurables.length, 'bytes');
      
      expect(bytesToHex(loaderComponents.blobId)).toBe(blobId);
    }

    // STEP 2: Deploy blob
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 2: Blob Deployment');
    console.log('-'.repeat(80));
    
    // Pad EVM address for configurables
    const cleanAddress = evmWallet.address.toLowerCase().replace('0x', '');
    const paddedAddress = cleanAddress.padStart(64, '0');
    
    // Create Simple predicate instance (full bytecode) for blob deployment
    const simplePredicate = new Simple({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [], // Empty data array
    });
    
    // Deploy as blob using the funding wallet
    console.log('Deploying blob with SDK provider...');
    const deployResult = await deployPredicateBlob(simplePredicate, fundingWallet);
    console.log('Deployment result:', deployResult.status);
    console.log('Deployed BlobID:', deployResult.blobId);
    
    if (deployResult.transactionId) {
      console.log('Transaction ID:', deployResult.transactionId);
    }
    
    expect(deployResult.blobId).toBe(blobId);

    // STEP 3: Create loader instance for transactions
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 3: Loader Initialization');
    console.log('-'.repeat(80));
    
    predicateLoader = new SimpleLoader({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    console.log('Loader Address:', predicateLoader.address.toString());
    console.log('Loader uses blob:', blobId);

    // STEP 4: Fund the loader address
    console.log('\n' + '-'.repeat(80));
    console.log('STEP 4: Funding Loader');
    console.log('-'.repeat(80));
    
    const tx = await fundingWallet.transfer(
      predicateLoader.address,
      bn(1000000),
      baseAssetId
    );
    await tx.waitForResult();
    
    console.log('✅ Loader funded with 1000000 units');
    console.log('='.repeat(80) + '\n');
  });

  afterAll(() => {
    if (cleanup) {
      cleanup();
      console.log('\n✅ Test node cleaned up\n');
    }
  });

  it('should successfully spend from predicate using blob loader with EIP-191 signature', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('TRANSACTION EXECUTION TEST');
    console.log('='.repeat(80));
    
    // Create a simple transaction
    const recipient = WalletUnlocked.generate({ provider });
    const amountToSend = bn(1234);

    console.log('Recipient:', recipient.address.toString());
    console.log('Amount to send:', amountToSend.toString());

    // Build transaction request with gas price
    const request = new ScriptTransactionRequest({
      gasLimit: bn(100000),
      maxFeePerGas: bn(1), // Set minimum gas price
    });

    // Add predicate input (using LOADER)
    console.log('\n📦 Using loader predicate for transaction inputs...');
    const resources = await predicateLoader.getResourcesToSpend([
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
      predicateLoader.address,
      await provider.getBaseAssetId()
    );

    // Add placeholder witness (64 bytes of zeros)
    console.log('\n🔐 Adding placeholder witness...');
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
    console.log('\n✍️  Signing with EVM wallet...');
    const txIdString = txId.slice(2); // Remove '0x'
    const signature = await evmWallet.signMessage(txIdString);
    console.log('Signature:', signature);

    // Convert to compact format
    const compactSig = toCompactSignature(signature);
    console.log('Compact signature:', compactSig);

    // Convert hex string to bytes
    const compactBytes = new Uint8Array(
      compactSig.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    // Replace placeholder with real signature
    request.witnesses[witnessIndex] = compactBytes;

    // Set witness index on predicate inputs
    request.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = witnessIndex;
      }
    });

    console.log('\n🔬 Estimating predicates...');
    console.log('Note: Network will fetch full predicate bytecode from blob storage using BlobID:', blobId);

    // Estimate predicates (network fetches blob automatically)
    const estimated = await provider.estimatePredicates(request);
    console.log('Estimated predicateGasUsed:', estimated.inputs[0].predicateGasUsed?.toString());

    // Set gas price AFTER estimation (estimatePredicates resets it)
    estimated.maxFeePerGas = bn(1);
    estimated.gasLimit = bn(100000);

    // Send transaction
    console.log('\n🚀 Sending transaction with blob loader...');

    const { waitForResult } = await provider.sendTransaction(estimated, {
      estimateTxDependencies: false,
    });

    const result = await waitForResult();

    console.log('\n✅ Transaction succeeded!');
    console.log('Transaction ID:', result.id);
    console.log('Status:', result.status);
    console.log('Block height:', result.blockId);

    console.log('\n📊 Summary:');
    console.log('  - Used loader:', SimpleLoader.bytecode.length, 'bytes');
    console.log('  - Referenced blob:', blobId);
    console.log('  - Network fetched full bytecode from blob storage');
    console.log('  - Transaction executed successfully');
    
    console.log('='.repeat(80) + '\n');

    expect(result.status).toBe('success');
  });

  /*
  it('should demonstrate loader vs full predicate size comparison', () => {
    console.log('\n' + '='.repeat(80));
    console.log('SIZE COMPARISON');
    console.log('='.repeat(80));
    
    const fullSize = Simple.bytecode.length;
    const loaderSize = SimpleLoader.bytecode.length;
    const savedBytes = fullSize - loaderSize;
    const savingsPercent = ((savedBytes / fullSize) * 100).toFixed(2);
    
    console.log(`Full Predicate:   ${fullSize.toString().padStart(6)} bytes`);
    console.log(`Loader Predicate: ${loaderSize.toString().padStart(6)} bytes`);
    console.log(`Savings:          ${savedBytes.toString().padStart(6)} bytes (${savingsPercent}%)`);
    console.log('\nBenefit: Blob is deployed once, loader is used for all transactions');
    console.log('='.repeat(80) + '\n');
    
    expect(loaderSize).toBeLessThan(fullSize);
    expect(loaderSize).toBeLessThan(200); // Loader should be very small
  });

  it('should verify loader and full predicate have different addresses (expected)', () => {
    // Create full predicate with same configurables
    const cleanAddress = evmWallet.address.toLowerCase().replace('0x', '');
    const paddedAddress = cleanAddress.padStart(64, '0');
    
    const fullPredicate = new Simple({
      provider,
      configurableConstants: {
        OWNER_ADDRESS: `0x${paddedAddress}`,
      },
      data: [],
    });
    
    // Addresses should be DIFFERENT because bytecode is different
    // The loader has smaller bytecode that references the blob
    // The full predicate has the complete bytecode
    console.log('\n' + '='.repeat(80));
    console.log('ADDRESS VERIFICATION');
    console.log('='.repeat(80));
    console.log('Full Predicate Address:', fullPredicate.address.toString());
    console.log('Loader Address:        ', predicateLoader.address.toString());
    console.log('Addresses are different (expected):', !fullPredicate.address.equals(predicateLoader.address) ? '✅' : '❌');
    console.log('\nNote: Different addresses are EXPECTED because:');
    console.log('  - Full predicate has complete bytecode (~4KB)');
    console.log('  - Loader has minimal bytecode that references the blob (~120 bytes)');
    console.log('  - Predicate address = sha256(bytecode + configurables)');
    console.log('  - Funds must be sent to the LOADER address for transactions');
    console.log('='.repeat(80) + '\n');
    
    // Verify they are different
    expect(predicateLoader.address.toString()).not.toBe(fullPredicate.address.toString());
  });
  */
});