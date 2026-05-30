/**
 * PM2 process for the reward API (SQLite — keep instances: 1).
 * Run from repo root on the VPS: `pm2 startOrReload ecosystem.config.cjs`
 */
module.exports = {
  apps: [
    {
      name: 'bestbond-reward-api',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1800M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
