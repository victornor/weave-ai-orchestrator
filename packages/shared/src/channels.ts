/** Well-known secret-store names for channel credentials the workspace secret store holds (VS-125). Shared so core's loader (which cannot import a channel package) and server's channel code name the same secret consistently. */
export const TELEGRAM_BOT_TOKEN_SECRET_NAME = 'telegram-bot-token';
export const TELEGRAM_BOT_TOKEN_ENV_VAR_NAME = 'TELEGRAM_BOT_TOKEN';
