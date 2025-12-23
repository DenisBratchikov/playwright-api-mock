import express from 'express';
import { fileURLToPath } from 'node:url';

export async function startServer(port = 3000) {
  const app = express();

  app.get('/api/users/me', (req, res) => {
    const tier = req.query.tier ?? 'Free';
    res.json({
      id: 1,
      name: tier === 'Expert' ? 'Dr. Jane' : 'John Doe',
      email: 'john@example.com',
      tier,
    });
  });

  app.get('/api/subscription/plan', (req, res) => {
    const tier = req.query.tier ?? 'Free';
    res.json({
      plan: tier,
      limits: tier === 'Free' ? 'basic' : 'premium',
    });
  });

  app.get('/', (_req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <body>
          <h1>Variant Demo</h1>
          <pre id="user"></pre>
          <pre id="plan"></pre>
          <script type="module">
            const tier = new URLSearchParams(window.location.search).get('tier') || 'Free';
            fetch('/api/users/me?tier=' + tier)
              .then(r => r.json())
              .then(data => {
                document.getElementById('user').textContent = JSON.stringify(data);
              });
            fetch('/api/subscription/plan?tier=' + tier)
              .then(r => r.json())
              .then(data => {
                document.getElementById('plan').textContent = JSON.stringify(data);
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
