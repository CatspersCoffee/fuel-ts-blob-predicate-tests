// libs/fuel_ts_test/fuels.config.ts
import { createConfig } from 'fuels';
import { resolve } from 'path';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

/*
export default createConfig({
  predicates: [
    resolve(__dirname, './predicates/simple')
  ],
  
  output: resolve(__dirname, './src/generated'),
  
  forcBuildFlags: ['--release'],
  
  // setup to deploy to node
  autoStartFuelCore: true,
  fuelCorePort: 4001, // Different port from root (4000)
  providerUrl: 'http://localhost:4001/v1/graphql',

  // providerUrl: 'http://localhost:4000/v1/graphql', // Use default port
  
  // Specify the fuel-core binary path
  fuelCorePath: '/home/catsper/.fuelup/toolchains/fc46_s0_66_6/bin/fuel-core',

  // Skip version checks
  useSystemForcAndFuelCore: true,


  // This will now read from .env file
  privateKey: process.env.DEFAULT_SEEDED_PRIVATE_KEY || '0x2aa963cb03de1a6a833625567628e25a1843235c8e4f8b3600f816c05b8f7357',

  deployConfig: {},
  
  onDeploy: (config) => {
    console.log('✅ Predicate loaders generated and deployed successfully!');
  }
});
*/



dotenv.config({ path: resolve(__dirname, '../../.env') });

export default createConfig({
  // Fix the workspace path - point to the predicates directory
  workspace: resolve(__dirname, '../../predicates'),
  
  output: resolve(__dirname, '../../src/generated'),
  
  forcBuildFlags: ['--release'],
  autoStartFuelCore: true,
  fuelCorePort: 4001,
  fuelCorePath: '/home/catsper/.fuelup/toolchains/fc46_s0_66_6/bin/fuel-core',
  
  privateKey: process.env.DEFAULT_SEEDED_PRIVATE_KEY,
  deployConfig: {},
  
  onDeploy: (config) => {
    console.log('✅ Loaders generated!');
  }
});