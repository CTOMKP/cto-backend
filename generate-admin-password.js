/**
 * Generate a bcrypt hash for admin password
 * Run with: node generate-admin-password.js YOUR_PASSWORD
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.log('Usage: node generate-admin-password.js YOUR_PASSWORD');
  console.log('Example: node generate-admin-password.js admin123');
  process.exit(1);
}

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error generating hash:', err);
    process.exit(1);
  }
  
  console.log('\n✅ Password hash generated!\n');
  console.log('Plain password:', password);
  console.log('Hashed password:', hash);
  console.log('\nAdd this to your .env file:');
  console.log(`ADMIN_EMAIL=admin@ctomemes.xyz`);
  console.log(`ADMIN_PASSWORD=${hash}`);
  console.log('\n⚠️  Keep the hashed version in .env, not the plain password!\n');
});

