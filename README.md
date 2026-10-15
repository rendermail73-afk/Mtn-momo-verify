# MoMo Verification Demo + Telegram Review

This is a clearly labelled demo, not an official MTN service.

## What it does
- Number page appears before the dummy PIN page.
- OTP 1 asks for a **synthetic sample SMS message**.
- OTP 2 uses the fixed demo code `222222`.
- The server sends a Telegram message containing only a demo reference, stage, and predefined synthetic test values.
- Telegram includes **Approve Demo** and **Decline Demo** inline buttons.
- The site can check the review result and show the corresponding demo screen.

## Security boundaries
Entered phone numbers, PINs, OTPs, and SMS text are never sent to the server or Telegram. Telegram messages use predefined synthetic values only. Do not use real credentials or real SMS messages.

## Run
1. Install Node.js 18 or later.
2. Run `npm install`.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your hosting environment.
4. Run `npm start`.
5. Deploy the project as a Node web service. The server uses Telegram `getUpdates` polling for callback buttons; do not configure a webhook for the same bot while polling is active.

## Environment variables
- `TELEGRAM_BOT_TOKEN`: private bot token from BotFather.
- `TELEGRAM_CHAT_ID`: chat that receives demo notifications.
- `PORT`: optional; hosting platform usually sets it.

Never put the bot token in frontend files or commit it to GitHub.
