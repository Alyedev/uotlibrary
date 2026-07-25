// Process-manager config for pm2 (https://pm2.keymetrics.io/), so the server
// automatically restarts if it crashes or the machine reboots, instead of
// staying down until someone notices and manually runs `npm start` again.
//
// Usage:
//   npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup        (follow its printed instructions to survive a reboot)
//
// Logs land in ./logs/ — rotate them with `pm2 install pm2-logrotate` if
// this runs for a long time.
module.exports = {
  apps: [
    {
      name: 'library',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
