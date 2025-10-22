import { Provider, WalletUnlocked } from 'fuels';
import { launchTestNode } from 'fuels/test-utils';
import { signMessage } from 'viem/accounts';
import { privateKeyToAccount } from 'viem/accounts';
import type { EIP1193Provider, PrivateKeyAccount } from 'viem';



// Test configuration

//#address    : 0x333339d42a89028ee29a9e9f4822e651bac7ba14
//UNIT_TEST_EVM_ADDR3_SK=a45f8875ccb5e0a756e5e65f509b372356bdee7699cc6236a417ad8f8d2a3839
export const TEST_PRIVATE_KEY =
  process.env.TEST_PRIVATE_KEY ||
  '0xa45f8875ccb5e0a756e5e65f509b372356bdee7699cc6236a417ad8f8d2a3839';

const FUEL_WALLET_PRIVATE_KEY = 
  process.env.FUEL_LOCALNODE_PRIVATE_KEY || 
  '0x0000000000000000000000000000000000000000000000000000000000000001';


const INITIAL_WALLET_BALANCE = 1_000_000_000;

export class SimplePredicateTestContext {
  constructor(
    public provider: Provider,
    public fundingWallet: WalletUnlocked,
    public evmProvider: EIP1193Provider,
    public evmAccount: PrivateKeyAccount,
    public cleanup: () => void
  ) {}

  public static async create(): Promise<SimplePredicateTestContext> {
    try {
      // Create EVM account from private key
      const evmAccount = privateKeyToAccount(TEST_PRIVATE_KEY as `0x${string}`);

      // Create EVM provider for signing
      const evmProvider = {
        request: async args => {
          if (args.method === 'eth_sign') {
            const [address, message] = args.params as [`0x${string}`, `0x${string}`];

            if (address.toLowerCase() !== evmAccount.address.toLowerCase()) {
              throw new Error(`Address mismatch: expected ${evmAccount.address}, got ${address}`);
            }

            // EIP-191 Personal Sign - convert txId hex to UTF-8 string
            const txIdString = message.slice(2); // Remove 0x prefix
            
            // Sign using EIP-191 with the STRING representation
            const signature = await signMessage({
              message: txIdString,
              privateKey: TEST_PRIVATE_KEY as `0x${string}`,
            });

            console.log('🔏 Signing EIP-191 of UTF-8 string:', txIdString);
            console.log('🔏 Signature:', signature);

            return signature;
          }
          if (args.method === 'eth_chainId') {
            return '0x1'; // Ethereum mainnet
          }
          throw new Error(`Unsupported method: ${args.method}`);
        },
        on: () => {},
        removeListener: () => {},
      } as EIP1193Provider;

      // Launch a test node
      const {
        provider: testNodeProvider,
        wallets: testNodeWallets,
        cleanup,
      } = await launchTestNode({
        walletsConfig: {
          count: 5,
          amountPerCoin: INITIAL_WALLET_BALANCE,
          assets: 1,
        },
      });

      // Create funding wallet from a specific private key
      const fundingWallet = new WalletUnlocked(FUEL_WALLET_PRIVATE_KEY, testNodeProvider);

      const wallets = [fundingWallet, ...testNodeWallets];

      const sacrificialWallet = wallets.pop();

      if (!sacrificialWallet) {
        throw new Error('No sacrificial wallet found');
      }

      // Fund the funding wallet
      await sacrificialWallet.transfer(fundingWallet.address, INITIAL_WALLET_BALANCE - 100000);

      console.log('EVM Address:', evmAccount.address);
      console.log('Fuel Funding Wallet:', fundingWallet.address.toString());

      return new SimplePredicateTestContext(
        testNodeProvider,
        fundingWallet,
        evmProvider,
        evmAccount,
        cleanup
      );
    } catch (error) {
      console.error('Setup failed:', error);
      throw error;
    }
  }
}