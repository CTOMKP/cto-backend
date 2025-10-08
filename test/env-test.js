require('dotenv').config();

console.log('Environment Variables Test:');
console.log('PANORA_API_KEY:', process.env.PANORA_API_KEY);
console.log('PANORA_BASE_URL:', process.env.PANORA_BASE_URL);
console.log('CIRCLE_API_KEY:', process.env.CIRCLE_API_KEY ? 'Found' : 'Not found');

// Test if the API key is the correct one
const expectedKey = 'a4^KV_EaTf4MW#ZdvgGKX#HUD^3IFEAOV_kzpIE^3BQGA8pDnrkT7JcIy#HNlLGi';
const actualKey = process.env.PANORA_API_KEY;

console.log('\nAPI Key Comparison:');
console.log('Expected:', expectedKey);
console.log('Actual:  ', actualKey);
console.log('Match:   ', expectedKey === actualKey);
