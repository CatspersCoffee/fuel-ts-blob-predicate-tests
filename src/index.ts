import { Provider, Predicate, WalletUnlocked, bn } from 'fuels';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SimpleLoader } from './generated/predicates/SimpleLoader';

export async function loadPredicate(
  provider: Provider,
  evmAddress: string
): Promise<Predicate> {
  // Load predicate bytecode and ABI from the correct paths
  const predicatePath = resolve(process.cwd(), 'predicates/simple/out/release/simple.bin');
  const abiPath = resolve(process.cwd(), 'predicates/simple/out/release/simple-abi.json');
  
  const bytecode = readFileSync(predicatePath);
  const abi = JSON.parse(readFileSync(abiPath, 'utf8'));
  
  // Pad EVM address to 32 bytes (remove 0x prefix if present)
  const cleanAddress = evmAddress.toLowerCase().replace('0x', '');
  const paddedAddress = cleanAddress.padStart(64, '0');
  
  return new Predicate({
    bytecode,
    abi,
    provider,
    configurableConstants: {
      OWNER_ADDRESS: `0x${paddedAddress}`,
    },
  });
}

export async function fundPredicate(
  wallet: WalletUnlocked,
  predicate: Predicate,
  amount: string
) {
  const baseAssetId = await wallet.provider.getBaseAssetId();
  
  const tx = await wallet.transfer(
    predicate.address,
    bn(amount),
    baseAssetId
  );
  
  await tx.waitForResult();
  
  console.log(`✅ Funded predicate with ${amount}`);
}

/**
 * Load a predicate loader (smaller bytecode that references deployed blob)
 */
export async function loadPredicateLoader(
  provider: Provider,
  evmAddress: string
): Promise<SimpleLoader> {
  // Pad EVM address to 32 bytes (remove 0x prefix if present)
  const cleanAddress = evmAddress.toLowerCase().replace('0x', '');
  const paddedAddress = cleanAddress.padStart(64, '0');
  
  return new SimpleLoader({
    provider,
    configurableConstants: {
      OWNER_ADDRESS: `0x${paddedAddress}`,
    },
  });
}

