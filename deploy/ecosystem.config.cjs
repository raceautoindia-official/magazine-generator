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
      args: "start -p 4310 -H 127.0.0.1", // only nginx on this machine can reach it
      // One process, in fork mode: the login limiter and background jobs assume a single process, and PM2's
      // cluster mode would ignore "interpreter" and run the app on the daemon's own Node.
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production" },
      max_memory_restart: "2G",
    },
  ],
};
