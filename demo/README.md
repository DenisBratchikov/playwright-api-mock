# Demo

This folder contains a minimal Playwright project showing how to use **playwright-api-mock**.

## Setup

1. Install Playwright browsers:
   ```bash
   npm run demo:install
   ```
2. (Optional) start the demo server to explore manually:
   ```bash
   npm run demo:start
   ```
   The server runs on `http://localhost:3000`.
3. Run tests (the server is started automatically):
   ```bash
   npm run demo:test
   ```

The project uses the plugin in `tests/fixtures.ts` to automatically record and mock API calls.
