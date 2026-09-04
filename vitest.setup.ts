// The suite must never talk to a live daemon. A worker developing AgentConductor *inside*
// AgentConductor inherits AC_RUN_TOKEN / AC_API_URL / AC_WORKSPACE_ID from its own run; tests that
// build clients or read the environment would otherwise reach the daemon that is running them.
for (const key of Object.keys(process.env)) if (key.startsWith('AC_')) delete process.env[key];
