// PM2 process file. Start with: pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "magazine-generator",
      cwd: __dirname + "/..",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3100",
      instances: 1, // the login limiter and generation jobs assume a single process
      env: { NODE_ENV: "production" },
      max_memory_restart: "2G",
    },
  ],
};
