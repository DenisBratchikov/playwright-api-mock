import express from 'express';
import { fileURLToPath } from 'node:url';

export async function startServer(port = 3000) {
  const app = express();

  app.get('/api/user', (_req, res) => {
    res.json({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      role: 'admin',
    });
  });

  app.get('/', (_req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <body>
          <h1>Demo</h1>
          <pre id="output"></pre>
          <script type="module">
            fetch('/api/user').then(r => r.json()).then(data => {
              document.getElementById('output').textContent = JSON.stringify(data);
            });
          </script>
        </body>
      </html>
    `);
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

// Allow running this file directly via `node tests/server.js`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // eslint-disable-next-line no-console
  startServer().then(() => console.log('Server running on http://localhost:3000'));
}
