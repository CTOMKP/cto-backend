const axios = require('axios');
const INDEXER_URL = 'https://testnet.movementnetwork.xyz/v1/graphql';
const USER_ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';

async function queryIndexer() {
    const query = {
        query: `
        query GetFAEvents($address: String) {
          fungible_asset_activities(
            where: {owner_address: {_eq: $address}},
            order_by: {transaction_version: desc},
            limit: 10
          ) {
            transaction_version
            amount
            type
            asset_type
            is_frozen
            transaction_timestamp
          }
        }
        `,
        variables: { address: USER_ADDR }
    };

    try {
        const res = await axios.post(INDEXER_URL, query);
        console.log('Indexer Response:', JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error('Indexer Error:', e.response?.data || e.message);
    }
}

queryIndexer();

