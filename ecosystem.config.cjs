module.exports = {
  apps: [
    {
      name: "conductor",
      script: "npm",
      args: "run dev",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: 5000,
      restart_delay: 1000,
    },
  ],
};
