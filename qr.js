import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';

const router = express.Router();

// Utility: Remove directory safely
const removeSession = (path) => {
    if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true, force: true });
        console.log(`🧹 Session folder removed: ${path}`);
    }
};

// Main QR Route
router.get('/', async (req, res) => {
    const sessionId = `session_\( {Date.now()}_ \){Math.random().toString(36).substr(2, 9)}`;
    const sessionDir = `./qr_sessions/${sessionId}`;

    // Ensure base directory exists
    if (!fs.existsSync('./qr_sessions')) {
        fs.mkdirSync('./qr_sessions', { recursive: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    let socket = null;
    let qrSent = false;
    let connectionSuccess = false;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
            },
            printQRInTerminal: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            connectTimeoutMs: 60_000,
            defaultQueryTimeoutMs: 60_000,
            keepAliveIntervalMs: 30_000,
        });

        socket = sock;

        // Handle QR Code
        sock.ev.on('connection.update', async (update) => {
            const { qr, connection, lastDisconnect } = update;

            if (qr && !qrSent) {
                qrSent = true;
                try {
                    const qrImage = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        margin: 2,
                        scale: 8,
                        color: { dark: '#000', light: '#fff' }
                    });

                    qrcodeTerminal.generate(qr, { small: true });
                    console.log('📱 New QR Generated → Scan Now!');

                    res.json({
                        success: true,
                        qr: qrImage,
                        sessionId,
                        message: "Scan this QR code with WhatsApp → Linked Devices",
                        instructions: [
                            "Open WhatsApp on your phone",
                            "Go to Settings → Linked Devices",
                            "Tap 'Link a Device'",
                            "Point your camera at this QR code"
                        ]
                    });
                } catch (err) {
                    console.error('QR Generation Failed:', err);
                    if (!res.headersSent) res.status(500).json({ error: "Failed to generate QR" });
                }
            }

            if (connection === 'open') {
                connectionSuccess = true;
                console.log('✅ WhatsApp Connected Successfully!');

                const userJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
                if (!userJid) {
                    console.log('⚠️ User JID not found yet, delaying messages...');
                    setTimeout(() => sendWelcomeMessages(sock, sessionDir), 5000);
                } else {
                    sendWelcomeMessages(sock, sessionDir, userJid);
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = reason !== DisconnectReason.loggedOut;

                console.log(`Connection closed: ${reason || 'Unknown'}`);

                if (reason === DisconnectReason.loggedOut) {
                    console.log('Logged out – deleting session');
                    removeSession(sessionDir);
                }

                if (!connectionSuccess && !res.headersSent) {
                    res.status(500).json({ error: 'Connection failed or closed unexpectedly' });
                }

                if (shouldReconnect) {
                    setTimeout(() => sock.ws.connect(), 3000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Auto cleanup after 60 seconds if not connected
        setTimeout(() => {
            if (!connectionSuccess && !qrSent) {
                res.status(408).json({ error: "QR timeout – no scan detected" });
            }
            if (!connectionSuccess) {
                sock?.end();
                removeSession(sessionDir);
            }
        }, 60_000);

    } catch (error) {
        console.error('Socket Initialization Error:', error);
        removeSession(sessionDir);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to start WhatsApp session" });
        }
    }
});

// Function to send session + epic welcome
async function sendWelcomeMessages(sock, sessionDir, fallbackJid = null) {
    try {
        const userJid = fallbackJid || (sock.user?.id ? jidNormalizedUser(sock.user.id) : null);
        if (!userJid) return console.log("No user JID found");

        // Send session file
        const credsPath = `${sessionDir}/creds.json`;
        if (fs.existsSync(credsPath)) {
            await sock.sendMessage(userJid, {
                document: fs.readFileSync(credsPath),
                mimetype: 'application/json',
                fileName: 'creds.json'
            });
            console.log('Session file sent:', credsPath);
        }

        // Epic Welcome Image
        await sock.sendMessage(userJid, {
            image: { url: './media/loft.jpg' }, // Make sure this file exists
            caption: `🔥 *Welcome to LoftBase MD V2.0 – The King is Here!* 🔥\n\n` +
                     `🎉 Congratulations! You just joined the most powerful bot family!\n` +
                     `🚀 We are now *CONNECTED FOREVER* – I’m with you 24/7\n\n` +
                     `💡 *What’s New in V2.0?*\n` +
                     `✦ Lightning-fast AI chat\n` +
                     `✦ Brand new fun & useful commands\n` +
                     `✦ All bugs destroyed!\n\n` +
                     `🎵 Enjoy this vibe while we start our journey together 🎶\n\n` +
                     `👑 *We are connected forever. Let’s rule WhatsApp together!*`
        });

        // Welcome Music
        await sock.sendMessage(userJid, {
            audio: { url: './media/roft.mp3' },
            mimetype: 'audio/mp4',
            ptt: false,
            waveform: [10, 40, 80, 100, 90, 70, 90, 50, 80, 30, 90, 20, 100]
        });

        // Final Message
        await sock.sendMessage(userJid, {
            text: `💜 *We are now connected forever!* 💜\n\n` +
                  `Enjoy the bot to the maximum, but *never share* the session file with anyone – keep your account safe 🙏\n\n` +
                  `┌┤✑  Thank you for using LoftBase MD V2.0\n` +
                  `│©2026 ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™\n` +
                  `└─────────────────┈ ⳹\n\n` +
                  `💬 Need help? Just type: *.menu* or *.help* anytime`
        });

        console.log('All welcome messages sent successfully!');

        // Cleanup after success
        setTimeout(() => {
            removeSession(sessionDir);
            sock?.end();
        }, 15_000);

    } catch (err) {
        console.error('Failed to send welcome messages:', err);
    }
}

// Global error handling (optional but recommended)
process.on('unhandledRejection', (err) => {
    if (err?.message?.includes?.('rate-overlimit') || 
        err?.message?.includes?.('conflict') || 
        err?.message?.includes?.('timed out')) return;
    console.error('Unhandled Rejection:', err);
});

export default router;