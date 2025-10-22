# Fuel Predicate Test Suite

This repository contains test cases for Fuel predicates, including both standard predicates and blob-based predicates with loaders.

## Overview

The test suite demonstrates:
1. EIP-191 signature validation in Fuel predicates
2. Blob deployment for reducing transaction size
3. Gas estimation issues with the Fuel SDK
4. Working solutions and workarounds

## Prerequisites

- Node.js and npm
- Fuel toolchain (forc, fuel-core)
- Environment variables in `.env`:
  - `TEST_PRIVATE_KEY` - EVM private key for signing
  - `FUEL_LOCALNODE_PRIVATE_KEY` - Fuel wallet private key

## Pre-req

make sure you have `forc` in the path. Compiled with `0.66.6`.
make sure you have `fuel-core` in path, Used `0.46.0`.

Note 1: ts SDK compains that it wants `0.43.1` in tests.

Note 2: running the script below is not necessary if you already have the following:
```
./src/generated/predicates/
├── index.ts
├── SimpleLoader.ts
└── Simple.ts

```

## Setup

```bash
npm install

./compile_predicate_typegen_loader.sh
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test
npm test -- <test-file-name>
```


## Setup

### 1. Configure Environment Variables

Create a `.env` file in the root directory:

just copy:
```bash
FUEL_NETWORK_URL=http://127.0.0.1:4000/v1/graphql

# EVM  key for signing
TEST_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001

# For funding simple predicates in test
# public address: 0x6b63804cFBf9856E68e5B6e7aef238dC8311ec55bEC04dF774003A2c96e0418e
FUEL_LOCALNODE_PRIVATE_KEY=0xde97d8624a438121b86a1956544bd72ed68cd69f2c99555b08b1e8c51ffd511c

# For loader generation
DEFAULT_SEEDED_PRIVATE_KEY=0xb628252db8b585c60ebb2294104f841aff891452cf05e9ffcd7a0c17ca463924
```

### 2. Start a Local Fuel Node

```bash
# Start fuel-core on port 4000
fuel-core run --ip 0.0.0.0 --port 4000 --db-type in-memory
```


### 3. Fund Your Fuel Wallet
use state config:
```
  "coins": [
    {
      "tx_id": "0000000000000000000000000000000000000000000000000000000000000001",
      "output_index": 0,
      "tx_pointer_block_height": 0,
      "tx_pointer_tx_idx": 0,
      "owner": "6b63804cfbf9856e68e5b6e7aef238dc8311ec55bec04df774003a2c96e0418e",
      "amount": 1152921504606846976,
      "asset_id": "f8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07"
    },
```



## Build Process

### Build Predicates

```bash
# Build the Sway predicate contracts
npm run build:predicates
```

This compiles the predicate in `predicates/simple/src/main.sw` and outputs:
- `predicates/simple/out/release/simple.bin` (bytecode)
- `predicates/simple/out/release/simple-abi.json` (ABI)

### Generate TypeScript Types

```bash
# Generate TypeScript bindings from ABI
npm run typegen
```

This creates TypeScript types in `src/types/` for type-safe predicate interactions.

### Generate Loader
```
cd fuel_ts_test/deploy_configs/loader/
npx fuels dev
```

### just do all:
run
```
compile_predicate_typegen_loader.sh
```


## How It Works

1. **Predicate Setup**: The predicate is configured with an EVM address as `OWNER_ADDRESS`
2. **Funding**: A Fuel wallet transfers base assets to the predicate address
3. **Transaction Building**: A transaction is created spending from the predicate
4. **Signature Generation**: The transaction ID is signed with an EVM private key (EIP-191)
5. **Signature Conversion**: The 65-byte Ethereum signature is converted to 64-byte compact format
6. **Verification**: The predicate recovers the address from the signature and validates it matches `OWNER_ADDRESS`



## Test Cases Explained

### 1. `predicate-localnode.test.ts` - ✅ WORKING
**Purpose:** Tests standard predicate execution against a local Fuel node.

This test demonstrates the basic predicate flow using the full predicate bytecode (~4KB):
- Connects to a local Fuel node running on port 4000
- Deploys and funds a predicate that validates EIP-191 signatures
- Signs transaction IDs with an EVM wallet
- Successfully executes transactions

**Result:** Works perfectly with no gas estimation issues.

### 2. `predicate-with-sdk-provider.test.ts` - ✅ WORKING  
**Purpose:** Tests standard predicate execution using SDK's test node provider.

Identical to the localnode test but uses the SDK's `launchTestNode()` instead of connecting to localhost:
- Launches an in-memory test node
- Uses the same predicate bytecode and signing flow
- Demonstrates SDK provider compatibility

**Result:** Works perfectly - gas estimation functions correctly for full predicates.

### 3. `predicate-with-loader-sdk_SAMPLE_E.test.ts` - ❌ FAILING
**Purpose:** Tests blob-based predicates with loader to reduce transaction size.

This test attempts to optimize transaction size by:
- Deploying the full predicate bytecode (~4KB) as a blob (one-time operation)
- Using a loader predicate (~120 bytes) in transactions - 97% size reduction
- The loader references the blob ID, and the network fetches the full bytecode

**The Gas Estimation Problem:**

The test fails due to an issue in the gas estimation flow:

1. **Initial State:** Transaction is built with placeholder witness and signed
   - Original TX ID: `0xd41aeb6f5c8c29483ea3238a1055dd84952a17381eddc1601505c063bd64d766`

2. **After `estimatePredicates()`:** Gas parameters are cleared
   - `maxFeePerGas` becomes `undefined`
   - We manually set `maxFee` and `gasPrice` to fix this

3. **Critical Issue:** Modifying gas parameters changes the transaction ID
   - New TX ID: `0xc92bd9878965ac04080e18a9a419a342655bd78a01a8d72ccdbed1ea6a17414d`
   - The signature is now invalid (signed the old TX ID)

4. **Result:** Transaction fails with `PredicateVerificationFailed(Panic(PredicateReturnedNonOne))`

**What I've Done to Fix Gas Estimation:**

```typescript
// After estimatePredicates(), which clears gas parameters:
const gasLimit = estimated.gasLimit || bn(200000);
const gasPrice = bn(1);
const maxFee = gasLimit.mul(gasPrice).mul(2); // 2x buffer

// Set the correct properties the SDK uses
(estimated as any).maxFee = maxFee;
(estimated as any).gasPrice = gasPrice;
```

However, this modification changes the transaction hash, breaking the signature. The proper solution would be to:
1. Estimate gas BEFORE signing
2. Set all gas parameters
3. THEN sign the final transaction ID
4. Or re-sign after gas modification (shown in the code but not yet implemented)

## Key Findings

1. **Standard predicates work fine** - Both local node and SDK provider handle full predicate bytecode without issues

2. **Blob-based predicates have gas estimation issues** - The SDK's `estimatePredicates()` function doesn't properly preserve gas parameters when working with loader predicates

3. **Transaction ID instability** - Modifying gas parameters after signing invalidates signatures, requiring a re-signing flow


## Technical Details

- **Fuel SDK Version:** 0.101.2
- **Fuel Core Version:** 0.43.2
- **Predicate Size:** ~4112 bytes (full), ~120 bytes (loader)
- **Size Reduction with Blobs:** 97.1%