#!/bin/bash
set -e

echo "Building av-currencies-vin-worker..."
npm run build

echo "Build successful!"
echo "Deploying to Cloudflare Workers..."
wrangler deploy
echo "Deployment completed successfully!"
