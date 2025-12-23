/**
 * Test password verification script
 * Run this in the backend container to verify password hash works
 * 
 * Usage: node test-password-verification.js
 */

const bcrypt = require('bcryptjs');

// The password from seed script
const password = 'PJio7cmV0IDYasFc$$';

// The hash we just generated and updated in the database
const hashFromDb = '$2a$10$gWVrXu0JakfqvX04pir5ZeOY7XKW8cVFxIxj4Mn0d.f3T2OVkWE3.';

console.log('🔍 Testing password verification...\n');
console.log('Password:', password);
console.log('Password length:', password.length);
console.log('Hash:', hashFromDb);
console.log('Hash length:', hashFromDb.length);
console.log('Hash format:', hashFromDb.substring(0, 7));
console.log('');

// Test 1: Compare with the hash
bcrypt.compare(password, hashFromDb)
  .then(result => {
    console.log('✅ Password comparison result:', result);
    if (result) {
      console.log('✅ SUCCESS: Password matches hash!');
    } else {
      console.log('❌ FAILED: Password does NOT match hash!');
      console.log('\n🔍 Debugging...');
      
      // Test if password has any hidden characters
      console.log('Password bytes:', Buffer.from(password).toString('hex'));
      console.log('Password char codes:', password.split('').map(c => c.charCodeAt(0)));
      
      // Try generating a new hash to see if it matches
      console.log('\n🔍 Generating new hash to compare...');
      return bcrypt.hash(password, 10);
    }
  })
  .then(newHash => {
    if (newHash) {
      console.log('New hash:', newHash);
      console.log('Original hash:', hashFromDb);
      console.log('Hashes match:', newHash === hashFromDb);
      
      // Compare new hash with password
      return bcrypt.compare(password, newHash);
    }
  })
  .then(newResult => {
    if (newResult !== undefined) {
      console.log('New hash comparison:', newResult);
      if (newResult) {
        console.log('✅ New hash works with password - original hash might be wrong!');
      }
    }
  })
  .catch(err => {
    console.error('❌ Error:', err);
  });
