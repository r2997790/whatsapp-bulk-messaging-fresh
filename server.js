const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with proper CORS and transport settings
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Middleware
app.use(cors({
    origin: "*",
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global variables
let whatsappClient = null;
let currentQR = null;
let clientStatus = 'disconnected';
let connectionAttempts = 0;
let isConnected = false;

// Enhanced logging function
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleString();
    const emoji = {
        info: '📝',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        qr: '📱',
        connection: '🔗',
        client: '👤',
        socket: '🔍'
    };
    console.log(`${emoji[type] || '📝'} [${timestamp}] ${message}`);
}

// Initialize WhatsApp client
function initializeWhatsAppClient() {
    try {
        log('Initializing WhatsApp client...', 'info');
        
        whatsappClient = new Client({
            authStrategy: new LocalAuth({
                dataPath: './whatsapp-session'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
            }
        });

        setupWhatsAppEvents();
        
    } catch (error) {
        log(`Failed to initialize WhatsApp client: ${error.message}`, 'error');
        throw error;
    }
}

// Setup WhatsApp client events
function setupWhatsAppEvents() {
    whatsappClient.on('qr', async (qr) => {
        try {
            log('QR Code generated, creating data URL...', 'qr');
            currentQR = await qrcode.toDataURL(qr);
            clientStatus = 'qr-ready';
            isConnected = false;
            
            log('QR Code sent to all connected clients', 'success');
            // Send QR code to all connected clients
            io.emit('qr-code', currentQR);
            io.emit('status-update', {
                status: clientStatus,
                hasQR: true,
                qrCode: currentQR,
                isConnected: false
            });
            
        } catch (error) {
            log(`Error generating QR code: ${error.message}`, 'error');
        }
    });

    whatsappClient.on('ready', () => {
        log('WhatsApp client is ready!', 'success');
        clientStatus = 'connected';
        isConnected = true;
        currentQR = null;
        connectionAttempts = 0;
        
        io.emit('whatsapp-ready');
        io.emit('status-update', {
            status: clientStatus,
            hasQR: false,
            isConnected: true
        });
        log('WhatsApp ready event sent to all clients', 'success');
    });

    whatsappClient.on('authenticated', () => {
        log('WhatsApp client authenticated successfully', 'success');
        clientStatus = 'authenticated';
        isConnected = true;
        io.emit('whatsapp-authenticated');
        io.emit('status-update', {
            status: clientStatus,
            hasQR: false,
            isConnected: true
        });
    });

    whatsappClient.on('auth_failure', (msg) => {
        log(`WhatsApp authentication failure: ${msg}`, 'error');
        clientStatus = 'auth-failure';
        isConnected = false;
        currentQR = null;
        io.emit('whatsapp-auth-failure', msg);
        io.emit('status-update', {
            status: clientStatus,
            hasQR: false,
            isConnected: false
        });
    });

    whatsappClient.on('disconnected', (reason) => {
        log(`WhatsApp client disconnected: ${reason}`, 'warning');
        clientStatus = 'disconnected';
        isConnected = false;
        currentQR = null;
        io.emit('whatsapp-disconnected', reason);
        io.emit('status-update', {
            status: clientStatus,
            hasQR: false,
            isConnected: false
        });
    });

    whatsappClient.on('loading_screen', (percent, message) => {
        log(`WhatsApp loading: ${percent}% - ${message}`, 'info');
        io.emit('whatsapp-loading-screen', { percent, message });
    });

    whatsappClient.on('change_state', (state) => {
        log(`WhatsApp state changed: ${state}`, 'info');
        io.emit('whatsapp-state-change', state);
    });

    // Error handling
    whatsappClient.on('error', (error) => {
        log(`WhatsApp client error: ${error.message}`, 'error');
        io.emit('whatsapp-error', error.message);
    });
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    log(`Client connected: ${socket.id}`, 'client');
    
    // Send current status to newly connected client
    socket.emit('status-update', {
        status: clientStatus,
        hasQR: !!currentQR,
        qrCode: currentQR,
        isConnected: isConnected,
        connectionAttempts: connectionAttempts
    });
    
    // Send current QR code if available
    if (currentQR && clientStatus === 'qr-ready') {
        log(`Sending existing QR code to client: ${socket.id}`, 'qr');
        socket.emit('qr-code', currentQR);
    }

    // Handle QR code requests
    socket.on('request-qr', async () => {
        log(`QR code requested by client: ${socket.id}`, 'qr');
        
        if (currentQR && clientStatus === 'qr-ready') {
            socket.emit('qr-code', currentQR);
        } else if (clientStatus === 'disconnected' || !isConnected) {
            try {
                log('Starting WhatsApp client for QR generation...', 'info');
                await startWhatsAppClient();
            } catch (error) {
                log(`Error starting WhatsApp client: ${error.message}`, 'error');
                socket.emit('error', 'Failed to start WhatsApp client');
            }
        } else {
            socket.emit('status-update', { 
                status: clientStatus,
                isConnected: isConnected,
                hasQR: !!currentQR
            });
        }
    });

    // Handle reconnection requests
    socket.on('reconnect-whatsapp', async () => {
        log(`WhatsApp reconnection requested by client: ${socket.id}`, 'connection');
        try {
            if (whatsappClient) {
                await whatsappClient.destroy();
            }
            await startWhatsAppClient();
        } catch (error) {
            log(`Error reconnecting WhatsApp: ${error.message}`, 'error');
            socket.emit('error', 'Failed to reconnect WhatsApp');
        }
    });

    // Handle ping for connection checking
    socket.on('ping', () => {
        socket.emit('pong', { 
            status: clientStatus, 
            timestamp: Date.now(),
            hasQR: !!currentQR,
            isConnected: isConnected
        });
    });

    // Handle bulk message sending
    socket.on('send-bulk-messages', async (data) => {
        log(`Bulk message request from client: ${socket.id}`, 'info');
        
        if (!isConnected || clientStatus !== 'connected') {
            socket.emit('error', 'WhatsApp not connected. Please scan QR code first.');
            return;
        }

        try {
            const { numbers, message, delay = 2000 } = data;
            let sent = 0;
            let failed = 0;

            for (const number of numbers) {
                try {
                    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
                    await whatsappClient.sendMessage(chatId, message);
                    sent++;
                    socket.emit('message-sent', { number, status: 'sent', sent, total: numbers.length });
                    log(`Message sent to ${number}`, 'success');
                    
                    // Add delay between messages
                    if (delay > 0) {
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                } catch (error) {
                    failed++;
                    socket.emit('message-sent', { number, status: 'failed', error: error.message, sent, failed, total: numbers.length });
                    log(`Failed to send message to ${number}: ${error.message}`, 'error');
                }
            }

            socket.emit('bulk-complete', { sent, failed, total: numbers.length });
            log(`Bulk messaging complete: ${sent} sent, ${failed} failed`, 'info');

        } catch (error) {
            log(`Bulk messaging error: ${error.message}`, 'error');
            socket.emit('error', `Bulk messaging failed: ${error.message}`);
        }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        log(`Client disconnected: ${socket.id} - ${reason}`, 'client');
    });

    // Handle connection errors
    socket.on('error', (error) => {
        log(`Socket error from ${socket.id}: ${error}`, 'error');
    });
});

// Start WhatsApp client
async function startWhatsAppClient() {
    try {
        connectionAttempts++;
        log(`Starting WhatsApp client (attempt ${connectionAttempts})...`, 'connection');
        
        if (whatsappClient) {
            try {
                await whatsappClient.destroy();
            } catch (error) {
                log(`Error destroying existing client: ${error.message}`, 'warning');
            }
        }

        initializeWhatsAppClient();
        await whatsappClient.initialize();
        
        log('WhatsApp client initialization started', 'success');
        
    } catch (error) {
        log(`Failed to start WhatsApp client: ${error.message}`, 'error');
        clientStatus = 'error';
        isConnected = false;
        throw error;
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        whatsapp: clientStatus,
        isConnected: isConnected,
        attempts: connectionAttempts,
        timestamp: new Date().toISOString(),
        contacts: 0,
        groups: 0,
        templates: 0,
        logs: 0
    });
});

// API endpoint to get current status
app.get('/api/status', (req, res) => {
    res.json({
        status: clientStatus,
        hasQR: !!currentQR,
        isConnected: isConnected,
        connectionAttempts: connectionAttempts,
        connectedClients: io.engine.clientsCount
    });
});

// API endpoint to restart WhatsApp client
app.post('/api/restart', async (req, res) => {
    try {
        log('WhatsApp client restart requested via API', 'info');
        await startWhatsAppClient();
        res.json({ success: true, message: 'WhatsApp client restart initiated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket connection monitoring
function monitorConnections() {
    setInterval(() => {
        const connectedClients = io.engine.clientsCount;
        log(`Socket check: clients=${connectedClients}, status=${clientStatus}, hasQR=${!!currentQR}, isConnected=${isConnected}`, 'socket');
        
        // Auto-restart if no clients and disconnected for too long
        if (connectedClients === 0 && !isConnected && connectionAttempts < 5) {
            log('No clients connected and WhatsApp disconnected, attempting auto-restart...', 'warning');
            startWhatsAppClient().catch(error => {
                log(`Auto-restart failed: ${error.message}`, 'error');
            });
        }
    }, 30000); // Check every 30 seconds
}

// Error handling
process.on('uncaughtException', (error) => {
    log(`Uncaught exception: ${error.message}`, 'error');
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`Unhandled rejection at ${promise}: ${reason}`, 'error');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    log('Received SIGINT, shutting down gracefully...', 'warning');
    
    if (whatsappClient) {
        try {
            await whatsappClient.destroy();
            log('WhatsApp client destroyed', 'info');
        } catch (error) {
            log(`Error destroying WhatsApp client: ${error.message}`, 'error');
        }
    }
    
    server.close(() => {
        log('Server closed', 'info');
        process.exit(0);
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, async () => {
    log(`🚀 Server running on http://${HOST}:${PORT}`, 'success');
    log(`📱 WhatsApp Bulk Messaging Service Started`, 'success');
    
    // Start connection monitoring
    monitorConnections();
    
    // Initialize WhatsApp client
    try {
        await startWhatsAppClient();
    } catch (error) {
        log(`Initial WhatsApp client start failed: ${error.message}`, 'error');
        log('Server will continue running, clients can trigger restart', 'info');
    }
});

module.exports = { app, server, io };