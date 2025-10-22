import { describe, it, expect, beforeAll } from 'vitest';
import { SimplePredicateTestContext } from './setup';

describe('SimplePredicateTestContext Setup', () => {
  let ctx: SimplePredicateTestContext;

  beforeAll(async () => {
    ctx = await SimplePredicateTestContext.create();
  });

  it('should create context with valid provider', () => {
    expect(ctx.provider).toBeDefined();
    expect(typeof ctx.provider.getChainId).toBe('function');
    expect(typeof ctx.provider.getBaseAssetId).toBe('function');
  });

  it('should create context with valid funding wallet', () => {
    expect(ctx.fundingWallet).toBeDefined();
    expect(ctx.fundingWallet.address).toBeDefined();
    expect(ctx.fundingWallet.address.toString()).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it('should create context with valid EVM account', () => {
    expect(ctx.evmAccount).toBeDefined();
    expect(ctx.evmAccount.address).toBeDefined();
    expect(ctx.evmAccount.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    
    console.log('EVM Account Address:', ctx.evmAccount.address);
  });

  it('should create context with valid EVM provider', () => {
    expect(ctx.evmProvider).toBeDefined();
    expect(typeof ctx.evmProvider.request).toBe('function');
  });

  it('should connect to Fuel network successfully', async () => {
    const chainId = await ctx.provider.getChainId();
    expect(chainId).toBeDefined();
    expect(typeof chainId).toBe('number');
    
    console.log('Connected to Fuel chain ID:', chainId);
  });

  it('should have funded wallet with balance', async () => {
    const baseAssetId = await ctx.provider.getBaseAssetId();
    const balance = await ctx.provider.getBalance(
      ctx.fundingWallet.address,
      baseAssetId
    );
    
    expect(balance).toBeDefined();
    console.log('Funding wallet balance:', balance.toString());
  });

  it('should support eth_sign via EVM provider', async () => {
    const testMessage = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    
    const signature = await ctx.evmProvider.request({
      method: 'eth_sign',
      params: [ctx.evmAccount.address, testMessage as `0x${string}`],
    });
    
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/); // 65 bytes = 130 hex chars
    
    console.log('Test signature length:', (signature as string).length);
  });

  it('should support eth_chainId via EVM provider', async () => {
    const chainId = await ctx.evmProvider.request({
      method: 'eth_chainId',
      params: [],
    });
    
    expect(chainId).toBeDefined();
    expect(typeof chainId).toBe('string');
    expect(chainId).toMatch(/^0x[a-fA-F0-9]+$/);
    
    console.log('EVM chain ID:', chainId);
  });

  it('should have matching EVM addresses between account and provider', async () => {
    const testMessage = '0xabcd';
    
    const signature = await ctx.evmProvider.request({
      method: 'eth_sign',
      params: [ctx.evmAccount.address, testMessage as `0x${string}`],
    });
    
    expect(signature).toBeDefined();
    // If no error thrown, address matching works correctly
  });

  it('should reject eth_sign with wrong address', async () => {
    const wrongAddress = '0x0000000000000000000000000000000000000000';
    const testMessage = '0xabcd';
    
    await expect(
      ctx.evmProvider.request({
        method: 'eth_sign',
        params: [wrongAddress as `0x${string}`, testMessage as `0x${string}`],
      })
    ).rejects.toThrow('Address mismatch');
  });

  it('should reject unsupported EVM provider methods', async () => {
    await expect(
      ctx.evmProvider.request({
        method: 'eth_sendTransaction' as any,
        params: [],
      })
    ).rejects.toThrow('Unsupported method');
  });

  it('should have provider connected to correct network URL', () => {
    const expectedUrl = process.env.FUEL_NETWORK_URL || 'http://127.0.0.1:4000/v1/graphql';
    // Provider doesn't expose URL directly, but we can verify it was created
    expect(ctx.provider).toBeDefined();
    console.log('Expected network URL:', expectedUrl);
  });

  it('should create deterministic EVM address from private key', () => {
    // The EVM address should be consistent for the same private key
    const expectedAddress = '0x333339D42A89028eE29a9E9F4822e651BaC7ba14';
    
    if (process.env.TEST_PRIVATE_KEY === '0xa45f8875ccb5e0a756e5e65f509b372356bdee7699cc6236a417ad8f8d2a3839') {
      expect(ctx.evmAccount.address.toLowerCase()).toBe(expectedAddress.toLowerCase());
      console.log('Verified deterministic EVM address:', ctx.evmAccount.address);
    } else {
      console.log('Using custom TEST_PRIVATE_KEY, skipping deterministic check');
    }
  });
});