import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  WalletUnlocked,
  bn,
  Provider,
  transactionRequestify,
  TransactionType,
  ScriptTransactionRequest,
} from 'fuels';
import { launchTestNode } from 'fuels/test-utils';

/**
 * Basic test of assembleTx with WalletUnlocked (regular wallets)
 * 
 * This establishes a baseline understanding of how assembleTx works
 * with normal wallets before testing with predicates.
 * 
 * Flow:
 * 1. Create two wallets (sender and recipient)
 * 2. Use assembleTx to build a transfer
 * 3. Convert result to TransactionRequest
 * 4. Send the transaction
 */
describe('WalletUnlocked - assembleTx Basic Test', () => {
  let provider: Provider;
  let cleanup: () => void;
  let senderWallet: WalletUnlocked;
  let recipientWallet: WalletUnlocked;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('TESTING assembleTx WITH REGULAR WALLETS (WalletUnlocked)');
    console.log('='.repeat(80));

    const launched = await launchTestNode({
      walletsConfig: {
        count: 2,
        amountPerCoin: 10_000_000,
      },
    });

    provider = launched.provider;
    cleanup = launched.cleanup;
    senderWallet = launched.wallets[0];
    recipientWallet = launched.wallets[1];

    console.log('Wallets created:');
    console.log('  Sender:', senderWallet.address.toString());
    console.log('  Recipient:', recipientWallet.address.toString());
    
    const baseAssetId = await provider.getBaseAssetId();
    const senderBalance = await senderWallet.getBalance(baseAssetId);
    console.log('  Sender balance:', senderBalance.toString());
    console.log('='.repeat(80) + '\n');
  });

  afterAll(() => {
    if (cleanup) {
      cleanup();
    }
  });

  it('should successfully use assembleTx for wallet-to-wallet transfer', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('WALLET-TO-WALLET TRANSFER USING assembleTx');
    console.log('='.repeat(80));
    
    const amountToSend = bn(1234);
    const baseAssetId = await provider.getBaseAssetId();

    console.log('\nTransaction parameters:');
    console.log('  From:', senderWallet.address.toString());
    console.log('  To:', recipientWallet.address.toString());
    console.log('  Amount:', amountToSend.toString());
    console.log('  Asset ID:', baseAssetId);

    // Get initial balances
    const initialSenderBalance = await senderWallet.getBalance(baseAssetId);
    const initialRecipientBalance = await recipientWallet.getBalance(baseAssetId);
    console.log('\nInitial balances:');
    console.log('  Sender:', initialSenderBalance.toString());
    console.log('  Recipient:', initialRecipientBalance.toString());

    // Test assembleTx
    console.log('\n--- Using assembleTx ---');
    
    try {
      // Call assembleTx
      console.log('Calling assembleTx...');
      const assembledTx = await senderWallet.assembleTx({
        to: recipientWallet.address,
        amount: amountToSend,
        assetId: baseAssetId,
      });

      console.log('\n✅ assembleTx succeeded');
      console.log('  Result type:', typeof assembledTx);
      console.log('  Constructor:', assembledTx?.constructor?.name);
      
      // Convert to TransactionRequest
      const request = transactionRequestify(assembledTx);
      console.log('  Converted to:', request.constructor.name);
      console.log('  Transaction type:', TransactionType[request.type]);
      
      // Check if it's a script transaction
      if (request.type === TransactionType.Script) {
        const scriptRequest = request as ScriptTransactionRequest;
        console.log('  Inputs:', scriptRequest.inputs?.length);
        console.log('  Outputs:', scriptRequest.outputs?.length);
        console.log('  Witnesses:', scriptRequest.witnesses?.length);
        
        // Log some details about inputs/outputs
        if (scriptRequest.inputs && scriptRequest.inputs.length > 0) {
          console.log('\nInput details:');
          scriptRequest.inputs.forEach((input, i) => {
            console.log(`    Input ${i}: type=${InputType[input.type]}`);
          });
        }
        
        if (scriptRequest.outputs && scriptRequest.outputs.length > 0) {
          console.log('\nOutput details:');
          scriptRequest.outputs.forEach((output, i) => {
            console.log(`    Output ${i}: type=${OutputType[output.type]}`);
          });
        }
      }
      
      // Send the transaction
      console.log('\n--- Sending transaction ---');
      const { waitForResult } = await senderWallet.sendTransaction(assembledTx);
      const result = await waitForResult();
      
      console.log('\n✅ Transaction successful!');
      console.log('  Transaction ID:', result.id);
      console.log('  Status:', result.status);
      console.log('  Block:', result.blockId);
      console.log('  Gas used:', result.gasUsed?.toString());
      
      // Check final balances
      const finalSenderBalance = await senderWallet.getBalance(baseAssetId);
      const finalRecipientBalance = await recipientWallet.getBalance(baseAssetId);
      console.log('\nFinal balances:');
      console.log('  Sender:', finalSenderBalance.toString());
      console.log('  Recipient:', finalRecipientBalance.toString());
      
      // Verify the transfer
      const recipientReceived = finalRecipientBalance.sub(initialRecipientBalance);
      console.log('\nRecipient received:', recipientReceived.toString());
      expect(recipientReceived.toNumber()).toBe(amountToSend.toNumber());
      
      console.log('\n' + '='.repeat(80));
      console.log('CONFIRMED: assembleTx works correctly with WalletUnlocked');
      console.log('='.repeat(80));
      
    } catch (error: any) {
      console.log('\n❌ assembleTx failed');
      console.log('Error:', error.message);
      console.log('Stack:', error.stack);
      throw error;
    }
  });

  it('should successfully use createTransfer for wallet-to-wallet transfer', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('WALLET-TO-WALLET TRANSFER USING createTransfer');
    console.log('='.repeat(80));
    
    const amountToSend = bn(2000);
    const baseAssetId = await provider.getBaseAssetId();

    console.log('\nTransaction parameters:');
    console.log('  From:', senderWallet.address.toString());
    console.log('  To:', recipientWallet.address.toString());
    console.log('  Amount:', amountToSend.toString());
    console.log('  Asset ID:', baseAssetId);

    // Get initial balances
    const initialSenderBalance = await senderWallet.getBalance(baseAssetId);
    const initialRecipientBalance = await recipientWallet.getBalance(baseAssetId);
    console.log('\nInitial balances:');
    console.log('  Sender:', initialSenderBalance.toString());
    console.log('  Recipient:', initialRecipientBalance.toString());

    // Test createTransfer
    console.log('\n--- Using createTransfer ---');
    
    try {
      // Call createTransfer
      console.log('Calling createTransfer...');
      const transferTx = await senderWallet.createTransfer(
        recipientWallet.address,
        amountToSend,
        baseAssetId
      );

      console.log('\n✅ createTransfer succeeded');
      console.log('  Result type:', typeof transferTx);
      console.log('  Constructor:', transferTx?.constructor?.name);
      console.log('  Transaction type:', TransactionType[transferTx.type]);
      
      // Check if it's a script transaction
      if (transferTx.type === TransactionType.Script) {
        console.log('  Inputs:', transferTx.inputs?.length);
        console.log('  Outputs:', transferTx.outputs?.length);
        console.log('  Witnesses:', transferTx.witnesses?.length);
      }
      
      // Send the transaction
      console.log('\n--- Sending transaction ---');
      const { waitForResult } = await senderWallet.sendTransaction(transferTx);
      const result = await waitForResult();
      
      console.log('\n✅ Transaction successful!');
      console.log('  Transaction ID:', result.id);
      console.log('  Status:', result.status);
      console.log('  Block:', result.blockId);
      console.log('  Gas used:', result.gasUsed?.toString());
      
      // Check final balances
      const finalSenderBalance = await senderWallet.getBalance(baseAssetId);
      const finalRecipientBalance = await recipientWallet.getBalance(baseAssetId);
      console.log('\nFinal balances:');
      console.log('  Sender:', finalSenderBalance.toString());
      console.log('  Recipient:', finalRecipientBalance.toString());
      
      // Verify the transfer
      const recipientReceived = finalRecipientBalance.sub(initialRecipientBalance);
      console.log('\nRecipient received:', recipientReceived.toString());
      expect(recipientReceived.toNumber()).toBe(amountToSend.toNumber());
      
      console.log('\n' + '='.repeat(80));
      console.log('CONFIRMED: createTransfer works correctly with WalletUnlocked');
      console.log('='.repeat(80));
      
    } catch (error: any) {
      console.log('\n❌ createTransfer failed');
      console.log('Error:', error.message);
      console.log('Stack:', error.stack);
      throw error;
    }
  });

  it('should compare assembleTx with createTransfer', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('COMPARING assembleTx vs createTransfer');
    console.log('='.repeat(80));
    
    const amountToSend = bn(500);
    const baseAssetId = await provider.getBaseAssetId();

    // Test createTransfer
    console.log('\n--- Using createTransfer (old method) ---');
    const transferTx = await senderWallet.createTransfer(
      recipientWallet.address,
      amountToSend,
      baseAssetId
    );
    console.log('✅ createTransfer result:');
    console.log('  Type:', transferTx.constructor.name);
    console.log('  Inputs:', transferTx.inputs?.length);
    console.log('  Outputs:', transferTx.outputs?.length);

    // Test assembleTx
    console.log('\n--- Using assembleTx (new method) ---');
    const assembledTx = await senderWallet.assembleTx({
      to: recipientWallet.address,
      amount: amountToSend,
      assetId: baseAssetId,
    });
    const convertedTx = transactionRequestify(assembledTx);
    console.log('✅ assembleTx result:');
    console.log('  Type:', convertedTx.constructor.name);
    console.log('  Inputs:', convertedTx.inputs?.length);
    console.log('  Outputs:', convertedTx.outputs?.length);
    
    console.log('\nBoth methods work with WalletUnlocked!');
  });
});