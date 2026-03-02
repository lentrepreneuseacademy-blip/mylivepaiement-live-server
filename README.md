# 📡 MY LIVE PAIEMENT — Live Server

Serveur WebSocket pour la connexion en temps réel aux lives TikTok.  
Ce serveur tourne **séparément** de l'app Next.js principale.

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐     TikTok API     ┌─────────────┐
│  Dashboard       │ ◄──────────────── │  Live Server      │ ◄──────────────── │  TikTok Live │
│  (Next.js/       │   socket.io       │  (Node.js)        │  tiktok-live-     │  @username   │
│   Vercel)        │                   │  Railway/Render    │  connector        │              │
└─────────────────┘                    └──────────────────┘                    └─────────────┘
```

## Déploiement rapide

### Option 1 : Railway (recommandé)

1. Va sur [railway.app](https://railway.app) et connecte ton GitHub
2. Crée un nouveau projet → "Deploy from GitHub repo"
3. Sélectionne le repo du live-server
4. Railway détecte automatiquement Node.js
5. Ajoute les variables d'environnement :
   ```
   PORT=3001
   ALLOWED_ORIGINS=https://mylivepaiement.com,https://mylivepaiement.vercel.app
   ```
6. Déploie → copie l'URL générée (ex: `https://mylivepaiement-live-server.up.railway.app`)

### Option 2 : Render

1. Va sur [render.com](https://render.com) → New Web Service
2. Connecte le repo GitHub
3. Configuration :
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Plan** : Free (ou Starter pour plus de fiabilité)
4. Ajoute les variables d'environnement (comme ci-dessus)
5. Déploie → copie l'URL

### Option 3 : VPS (DigitalOcean, Hetzner, OVH...)

```bash
# Sur le serveur
git clone <ton-repo>
cd live-server
npm install
PORT=3001 ALLOWED_ORIGINS=https://mylivepaiement.com node server.js

# Ou avec PM2 pour que ça tourne en permanence :
npm install -g pm2
pm2 start server.js --name "live-server"
pm2 save
pm2 startup
```

## Après le déploiement

### Connecter au frontend

Ajoute cette variable dans ton projet Next.js (Vercel → Settings → Environment Variables) :

```
NEXT_PUBLIC_LIVE_SERVER_URL=https://ton-live-server.railway.app
```

Puis **redéploie** le projet Next.js.

### Vérifier que ça marche

```bash
# Health check
curl https://ton-live-server.railway.app/health

# Réponse attendue :
# {"status":"ok","uptime":123,"connections":0,"activeLives":0}
```

## Fonctionnalités

| Événement | Description |
|-----------|------------|
| `new-comment` | Chaque commentaire du live TikTok |
| `new-gift` | Cadeaux TikTok (roses, etc.) |
| `new-like` | Likes reçus |
| `viewer-join` | Nouveau viewer rejoint |
| `viewer-count` | Mise à jour du nombre de viewers |
| `live-ended` | Le live s'est terminé |
| `live-error` | Erreur de connexion |

## Événements émis par le client

| Événement | Payload | Description |
|-----------|---------|------------|
| `start-live` | `{ platform, username, shopId }` | Démarre la connexion à un live |
| `stop-live` | — | Arrête la connexion |

## Limitations connues

- **TikTok uniquement** : Instagram Live n'a pas d'API accessible
- **API non officielle** : `tiktok-live-connector` utilise le protocole interne de TikTok, qui peut changer
- **Rate limiting** : TikTok peut bloquer temporairement si trop de connexions simultanées
- **Le live doit être actif** : la connexion échoue si le créateur n'est pas en live

## Debug

Les logs du serveur affichent toutes les connexions/déconnexions :

```
[14:32:01] Client connecté: abc123
[14:32:01] Demande de connexion: tiktok @beautylive (shop: uuid...)
[14:32:03] ✓ Connecté au live TikTok de @beautylive (Room: 123456, Viewers: 47)
[14:35:12] Live terminé: @beautylive (action: 3)
[14:35:12] Connexion nettoyée: abc123 (@beautylive, 234 commentaires)
```

## Dépendances npm

| Package | Version | Rôle |
|---------|---------|------|
| `socket.io` | ^4.7.5 | Serveur WebSocket |
| `tiktok-live-connector` | ^1.1.8 | Connexion aux lives TikTok |

## Ajouter au frontend (package.json principal)

Dans ton app Next.js, ajoute le client WebSocket :

```bash
npm install socket.io-client
```

C'est un **import dynamique** dans le dashboard (`await import('socket.io-client')`), donc il ne sera chargé que quand l'utilisateur lance un live en mode réel.
