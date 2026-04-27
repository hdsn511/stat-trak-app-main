module.exports = {
  apps: [
    {
      name: 'stat-trak',
      script: 'dist/server.js',
      cwd: './server',
      env_file: './server/.env',
      restart_delay: 5000,
      max_restarts: 5,
    },
  ],
};
