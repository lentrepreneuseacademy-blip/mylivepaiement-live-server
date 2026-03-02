// ═══════════════════════════════════════════════════════════════
// MYLIVEPAIEMENT — Live Server
// Serveur WebSocket séparé pour la connexion aux lives TikTok/Instagram
// Déployer sur Railway, Render, Fly.io ou un VPS
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

// ─── Config ───
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'https://mylivepaiement.com', 'https://mylivepaiement.vercel.app'];

// ─── Server ───
const server = http.createServer((req, res) => {
  // Health check endpoint (pour Railway/Render)
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      connections: io?.engine?.clientsCount || 0,
      activeLives: activeLives.size,
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// ─── Track active connections ───
// Map<socketId, { tiktokConnection, username, platform, shopId }>
const activeLives = new Map();

// ═══ CONNECTION HANDLER ═══
io.on('connection', (socket) => {
  console.log(`[${timestamp()}] Client connecté: ${socket.id}`);

  // ─── START LIVE ───
  socket.on('start-live', async ({ platform, username, shopId }) => {
    console.log(`[${timestamp()}] Demande de connexion: ${platform} @${username} (shop: ${shopId})`);

    if (!username || !platform) {
      socket.emit('live-error', { code: 'INVALID_PARAMS', message: 'Plateforme et username requis' });
      return;
    }

    // Nettoyer une connexion précédente si elle existe
    cleanupConnection(socket.id);

    if (platform === 'tiktok') {
      await connectTikTok(socket, username, shopId);
    } else if (platform === 'instagram') {
      // Instagram Live n'a pas d'API officielle
      // On renvoie une erreur claire pour le moment
      socket.emit('live-error', {
        code: 'PLATFORM_UNSUPPORTED',
        message: 'Instagram Live n\'est pas encore supporté. L\'API Instagram ne permet pas d\'accéder aux commentaires en live. Utilise le mode démo ou TikTok Live.',
      });
    } else {
      socket.emit('live-error', { code: 'UNKNOWN_PLATFORM', message: `Plateforme inconnue: ${platform}` });
    }
  });

  // ─── STOP LIVE ───
  socket.on('stop-live', () => {
    console.log(`[${timestamp()}] Arrêt demandé: ${socket.id}`);
    cleanupConnection(socket.id);
    socket.emit('live-status', { connected: false, reason: 'Déconnecté manuellement' });
  });

  // ─── DISCONNECT ───
  socket.on('disconnect', (reason) => {
    console.log(`[${timestamp()}] Client déconnecté: ${socket.id} (${reason})`);
    cleanupConnection(socket.id);
  });
});

// ═══ TIKTOK LIVE CONNECTION ═══
async function connectTikTok(socket, username, shopId) {
  try {
    // Nettoyer le @ si présent
    const cleanUsername = username.replace(/^@/, '').trim();

    const tiktokLive = new WebcastPushConnection(cleanUsername, {
      processInitialData: true,    // Traiter les données initiales
      fetchRoomInfoOnConnect: true, // Vérifier que le live existe
      enableExtendedGiftInfo: false,
      enableWebsocketUpgrade: true,
      requestPollingIntervalMs: 1000,
      sessionId: undefined,
    });

    // Stocker la connexion
    activeLives.set(socket.id, {
      tiktokConnection: tiktokLive,
      username: cleanUsername,
      platform: 'tiktok',
      shopId,
      startedAt: new Date(),
      commentCount: 0,
    });

    // ─── Connexion ───
    const state = await tiktokLive.connect();
    console.log(`[${timestamp()}] ✓ Connecté au live TikTok de @${cleanUsername} (Room: ${state.roomId}, Viewers: ${state.viewerCount || 0})`);

    socket.emit('live-status', {
      connected: true,
      platform: 'tiktok',
      username: cleanUsername,
      roomId: state.roomId,
      viewers: state.viewerCount || 0,
      title: state.roomInfo?.title || '',
    });

    // ─── CHAT (commentaires) ───
    tiktokLive.on('chat', (data) => {
      const conn = activeLives.get(socket.id);
      if (conn) conn.commentCount++;

      socket.emit('new-comment', {
        id: data.msgId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        username: data.uniqueId,
        nickname: data.nickname,
        text: data.comment,
        profilePic: data.profilePictureUrl,
        userId: data.userId,
        followRole: data.followRole, // 0 = pas follower, 1 = follower, 2 = ami
        timestamp: new Date().toISOString(),
      });
    });

    // ─── GIFT (cadeaux) ───
    tiktokLive.on('gift', (data) => {
      // Uniquement les cadeaux "stoppés" (streakEnd) pour éviter les doublons
      if (data.giftType === 1 && !data.repeatEnd) return;

      socket.emit('new-gift', {
        username: data.uniqueId,
        nickname: data.nickname,
        giftName: data.giftName || 'Cadeau',
        giftId: data.giftId,
        repeatCount: data.repeatCount || 1,
        diamondCount: data.diamondCount || 0,
        profilePic: data.profilePictureUrl,
        timestamp: new Date().toISOString(),
      });
    });

    // ─── LIKE ───
    tiktokLive.on('like', (data) => {
      socket.emit('new-like', {
        username: data.uniqueId,
        likeCount: data.likeCount,
        totalLikes: data.totalLikeCount,
      });
    });

    // ─── MEMBER JOIN ───
    tiktokLive.on('member', (data) => {
      socket.emit('viewer-join', {
        username: data.uniqueId,
        nickname: data.nickname,
        profilePic: data.profilePictureUrl,
      });
    });

    // ─── VIEWER COUNT UPDATE ───
    tiktokLive.on('roomUser', (data) => {
      socket.emit('viewer-count', {
        viewers: data.viewerCount,
      });
    });

    // ─── LIVE ENDED ───
    tiktokLive.on('streamEnd', (actionId) => {
      console.log(`[${timestamp()}] Live terminé: @${cleanUsername} (action: ${actionId})`);
      const conn = activeLives.get(socket.id);

      socket.emit('live-ended', {
        reason: actionId === 3 ? 'Live terminé par le créateur' : 'Le live s\'est terminé',
        totalComments: conn?.commentCount || 0,
        duration: conn ? Math.round((Date.now() - conn.startedAt.getTime()) / 1000) : 0,
      });

      cleanupConnection(socket.id);
    });

    // ─── ERREUR WebSocket ───
    tiktokLive.on('websocketConnected', (wsState) => {
      console.log(`[${timestamp()}] WebSocket upgrade OK pour @${cleanUsername}`);
    });

    tiktokLive.on('error', (err) => {
      console.error(`[${timestamp()}] Erreur TikTok @${cleanUsername}:`, err.message);
      socket.emit('live-error', {
        code: 'TIKTOK_ERROR',
        message: `Erreur de connexion TikTok: ${err.message}`,
      });
    });

  } catch (err) {
    console.error(`[${timestamp()}] Erreur connexion @${username}:`, err.message);

    let userMessage = '';
    const errMsg = err.message?.toLowerCase() || '';

    if (errMsg.includes('not found') || errMsg.includes('offline') || errMsg.includes('doesn\'t seem to be live')) {
      userMessage = `@${username} n'est pas en live actuellement. Vérifie que le live est bien lancé sur TikTok.`;
    } else if (errMsg.includes('rate') || errMsg.includes('blocked') || errMsg.includes('captcha')) {
      userMessage = 'TikTok a temporairement bloqué les connexions. Réessaie dans quelques minutes.';
    } else if (errMsg.includes('user not found') || errMsg.includes('user_not_found')) {
      userMessage = `L'utilisateur @${username} n'existe pas sur TikTok. Vérifie l'orthographe.`;
    } else {
      userMessage = `Impossible de se connecter au live de @${username}. ${err.message}`;
    }

    socket.emit('live-error', {
      code: 'CONNECTION_FAILED',
      message: userMessage,
    });

    cleanupConnection(socket.id);
  }
}

// ═══ CLEANUP ═══
function cleanupConnection(socketId) {
  const conn = activeLives.get(socketId);
  if (conn) {
    try {
      if (conn.tiktokConnection) {
        conn.tiktokConnection.disconnect();
      }
    } catch (e) {
      // Ignorer les erreurs de déconnexion
    }
    console.log(`[${timestamp()}] Connexion nettoyée: ${socketId} (@${conn.username}, ${conn.commentCount} commentaires)`);
    activeLives.delete(socketId);
  }
}

// ═══ UTILS ═══
function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

// ═══ GRACEFUL SHUTDOWN ═══
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] Arrêt en cours...');
  activeLives.forEach((conn, socketId) => cleanupConnection(socketId));
  io.close(() => {
    server.close(() => {
      console.log('[SHUTDOWN] Terminé');
      process.exit(0);
    });
  });
});

// ═══ START ═══
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║  MY LIVE PAIEMENT — Live Server              ║
║  Port: ${PORT}                                  ║
║  Origins: ${ALLOWED_ORIGINS.join(', ')}        
╚═══════════════════════════════════════════════╝
  `);
});
