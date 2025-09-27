module.exports = {
  apps: [
    {
      name: 'cto-backend',
      script: 'dist/main.js',
      // If your app needs a specific working dir, uncomment the next line
      // cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: './logs/pm2-err.log',
      out_file: './logs/pm2-out.log',
      time: true,
    },
  ],
};