import axios from 'axios';

const RPC_URL = 'https://testnet.movementnetwork.xyz/v1';
const ADMIN_WALLET = '0x64c2df62cb5a217fb8b358fe8e5e8d183a9a592d89bfd1a2839680e9e70991a2';

async function find() {
    try {
        const res = await axios.get(`${RPC_URL}/accounts/${ADMIN_WALLET}/resources`);
        console.log('--- ALL RESOURCES ---');
        res.data.forEach((r: any) => {
            if (r.type.includes('CoinStore')) {
                console.log('Found CoinStore:', r.type);
            }
        });
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}
find();



