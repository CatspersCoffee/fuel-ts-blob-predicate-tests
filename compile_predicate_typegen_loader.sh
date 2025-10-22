#!/bin/bash

# Run the first command
npm run build:predicates

# Wait for 1 second
sleep 1

# Run the second command
npm run typegen

# Wait for 1 second
sleep 1

cd ./deploy_configs/loader/
npx fuels dev

