// src/testFetcher.js
// Run this to verify live data is being fetched correctly
// Usage: node src/testFetcher.js

import { fetchYieldData, shouldAlert } from './dataFetcher.js';

async function runFetcherTest() {
  console.log('\n========================================');
  console.log('RWAI DATA FETCHER TEST');
  console.log('========================================\n');

  try {
    const yieldData = await fetchYieldData();

    console.log('\n--- Full yield data object ---');
    console.log(JSON.stringify(yieldData, null, 2));

    console.log('\n--- Alert check ---');
    const alert = shouldAlert(yieldData);
    console.log(`Should alert user? ${alert ? '✅ YES' : '❌ NO'}`);

    console.log('\n========================================');
    console.log('Data fetcher working. Wire it up.');
    console.log('========================================\n');

  } catch (err) {
    console.error('Fetcher test failed:', err);
  }
}

runFetcherTest();
