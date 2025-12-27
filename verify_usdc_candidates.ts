import axios from 'axios';

const RPC_URL = 'https://testnet.movementnetwork.xyz/v1';
const ADMIN_WALLET = '0x64c2df62cb5a217fb8b358fe8e5e8d183a9a592d89bfd1a2839680e9e70991a2';

const CANDIDATES = [
    '0x275f508601db54316982947c61f5162479f64866f830302ad9372136e0d37e19::usdc::USDC',
    '0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832::usdc::USDC',
    '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907923fbd351543ed24c397811::asset::USDC'
];

async function verify() {
    console.log('--- Verifying USDC Candidates on Movement Bardock ---');
    
    for (const candidate of CANDIDATES) {
        const owner = candidate.split('::')[0];
        try {
            const res = await axios.get(`${RPC_URL}/accounts/${owner}/resources`);
            const coinInfo = res.data.find((r: any) => r.type.includes('CoinInfo') && r.type.includes('USDC'));
            
            if (coinInfo) {
                console.log(`✅ MATCH FOUND: ${candidate}`);
                console.log(`Details: ${JSON.stringify(coinInfo.data, null, 2)}`);
                
                // Now check if Admin Wallet has a CoinStore for this
                try {
                    const adminRes = await axios.get(`${RPC_URL}/accounts/${ADMIN_WALLET}/resources`);
                    const hasStore = adminRes.data.some((r: any) => r.type.includes(`CoinStore<${candidate}>`));
                    console.log(`Admin Wallet Registered: ${hasStore ? 'YES' : 'NO'}`);
                } catch (e) {}
                
                return candidate;
            }
        } catch (e: any) {
            console.log(`❌ Candidate ${owner.substring(0, 10)}... not found or no USDC.`);
        }
    }
    console.log('--- No exact USDC match found via CoinInfo ---');
    return null;
}

verify();



