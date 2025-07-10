# Giardino Push Server

Backend per la gestione delle notifiche push per l'applicazione Giardino.

> **Nota**: Questo repository è configurato per essere deployato direttamente su Render senza sottocartelle.

## Funzionalità

- Gestione delle sottoscrizioni push
- Integrazione con broker MQTT per ricevere aggiornamenti in tempo reale
- Invio di notifiche push quando lo stato del giardino cambia
- Health check endpoint per il monitoring

## Endpoints

- `GET /health` - Health check per verificare lo stato del server
- `GET /vapidPublicKey` - Ottiene la chiave pubblica VAPID
- `POST /subscribe` - Registra una nuova subscription push
- `DELETE /unsubscribe` - Rimuove una subscription

## Deployment su Render

### 1. Preparazione del Repository

Assicurati che il tuo codice sia in un repository Git (GitHub, GitLab, etc.).

### 2. Configurazione su Render

1. Vai su [render.com](https://render.com) e crea un account
2. Clicca su "New +" e seleziona "Web Service"
3. Connetti il tuo repository Git
4. Configura il servizio:
   - **Name**: `giardino-push-server` (o il nome che preferisci)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (o il piano che preferisci)

### 3. Variabili d'Ambiente (Opzionale)

Se vuoi rendere le chiavi VAPID configurabili, puoi aggiungere queste variabili d'ambiente su Render:

- `VAPID_PUBLIC_KEY` - La tua chiave pubblica VAPID
- `VAPID_PRIVATE_KEY` - La tua chiave privata VAPID
- `VAPID_EMAIL` - L'email associata alle chiavi VAPID

### 4. Deploy

1. Clicca su "Create Web Service"
2. Render inizierà automaticamente il build e il deploy
3. Una volta completato, otterrai un URL pubblico (es: `https://giardino-push-server.onrender.com`)

## Configurazione Frontend

Nel tuo frontend React, aggiorna l'URL del server con quello fornito da Render:

```javascript
const PUSH_SERVER_URL = 'https://giardino-push-server.onrender.com';
```

## Monitoraggio

- Il servizio include un endpoint `/health` per il monitoring
- Render fornisce automaticamente logs e metriche
- Puoi configurare alerting per downtime

## Note Importanti

- Il servizio gratuito di Render ha limitazioni di tempo di inattività
- Le subscription vengono salvate localmente nel file system
- Per un ambiente di produzione, considera l'uso di un database persistente
- Le chiavi VAPID sono hardcoded nel codice - per maggiore sicurezza, usa le variabili d'ambiente

## Sviluppo Locale

```bash
npm install
npm start
```

Il server sarà disponibile su `http://localhost:4000` 