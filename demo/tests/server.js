import express from 'express';

export async function startServer(port = 3000) {
  const app = express();

  app.get('/api/user', (_req, res) => {
    res.json({ id: 1, name: 'John Doe' });
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
