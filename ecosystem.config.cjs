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
    {
      // The MCP HTTP transport. Vite proxies /mcp to this port, so the tunnel
      // publishes it as https://conductor-dev.convertedclick.co.za/mcp — which
      // means it must outlive the terminal that started it, or a teammate's
      // client goes dead the next time this Mac reboots.
      name: "conductor-mcp",
      script: "npm",
      args: "run http",
      // Absolute, via __dirname: `pm2 resurrect` runs from launchd at login with
      // cwd "/", so a relative path here resurrects as /mcp-server and dies.
      cwd: require("node:path").join(__dirname, "mcp-server"),
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: 5000,
      restart_delay: 1000,
    },
  ],
};
