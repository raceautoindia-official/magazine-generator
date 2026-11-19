// PM2 process file. Start with: pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "magazine-generator",
      cwd: __dirname + "/..",
      script: "node_modules/next/dist/bin/next",
      // The app needs Node 22.12 or newer. PM2 itself may run on an older Node: start with the Node of the
      // current shell (after "nvm use"), whatever version the PM2 daemon runs on.
      interpreter: process.execPath,
      args: "start -p 3100",
      instances: 1, // the login limiter and generation jobs assume a single process
      env: { NODE_ENV: "production" },
      max_memory_restart: "2G",
    },
  ],
};
