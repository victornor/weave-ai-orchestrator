-- The Telegram bot's own username (VS-125), shown in Settings so captain can confirm a saved token
-- is the right bot without the token itself ever being readable back out. Not a secret.
ALTER TABLE channels ADD COLUMN bot_username TEXT;
