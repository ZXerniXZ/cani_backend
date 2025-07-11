import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import webpush from 'web-push';
import mqtt from 'mqtt';
import mongoose from 'mongoose';
import Subscription from './subscription.model.js';

const VAPID_PUBLIC_KEY = 'BB8l__PCTsH5Xb1gaDl5pAO-XyrUJOCtD8JdJYyJhCxVacLalgk4dnWyHYkp3_q6yT8KVT4N2C3ziwGOA6tUcRQ';
const VAPID_PRIVATE_KEY = 'VnYONU0T2FAKAl3zHXeo2yZpjffzggoABinzANlt9lQ';

webpush.setVapidDetails(
  'mailto:tuamail@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connetti a MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://cani_user:cani_passwrod_7030@canidb.kurd9ld.mongodb.net/?retryWrites=true&w=majority&appName=caniDB';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connesso a MongoDB Atlas');
}).catch(err => {
  console.error('❌ Errore connessione MongoDB:', err);
});

// Health check endpoint per Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Push server is running' });
});

// Endpoint per ottenere la chiave pubblica VAPID
app.get('/vapidPublicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Endpoint per visualizzare le subscription attuali
app.get('/subscriptions', async (req, res) => {
  const subs = await Subscription.find();
  res.json({ 
    count: subs.length,
    subscriptions: subs 
  });
});

// Endpoint per registrare una subscription
app.post('/subscribe', async (req, res) => {
  try {
    const sub = req.body;
    const timestamp = new Date().toISOString();
    const exists = await Subscription.findOne({ endpoint: sub.endpoint });
    if (!exists) {
      await Subscription.create(sub);
      const count = await Subscription.countDocuments();
      console.log(`[${timestamp}] ✅ NUOVA SUBSCRIPTION REGISTRATA`);
      console.log(`   Endpoint: ${sub.endpoint.substring(0, 50)}...`);
      console.log(`   Totale subscription: ${count}`);
    } else {
      console.log(`[${timestamp}] ℹ️ SUBSCRIPTION GIÀ ESISTENTE`);
      console.log(`   Endpoint: ${sub.endpoint.substring(0, 50)}...`);
    }
    res.status(201).json({ message: 'Subscription registrata con successo' });
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERRORE REGISTRAZIONE SUBSCRIPTION:`, error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Endpoint per rimuovere una subscription
app.delete('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    const timestamp = new Date().toISOString();
    const result = await Subscription.deleteOne({ endpoint });
    const count = await Subscription.countDocuments();
    if (result.deletedCount > 0) {
      console.log(`[${timestamp}] 🗑️ SUBSCRIPTION RIMOSSA`);
      console.log(`   Endpoint: ${endpoint.substring(0, 50)}...`);
      console.log(`   Totale rimanenti: ${count}`);
      res.status(200).json({ message: 'Subscription rimossa con successo' });
    } else {
      console.log(`[${timestamp}] ⚠️ SUBSCRIPTION NON TROVATA`);
      console.log(`   Endpoint: ${endpoint.substring(0, 50)}...`);
      res.status(404).json({ error: 'Subscription non trovata' });
    }
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERRORE RIMOZIONE SUBSCRIPTION:`, error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Funzione per pulire subscription non valide
async function cleanInvalidSubscription(endpoint, errorCode, reason) {
  const timestamp = new Date().toISOString();
  const result = await Subscription.deleteOne({ endpoint });
  const count = await Subscription.countDocuments();
  if (result.deletedCount > 0) {
    console.log(`[${timestamp}] 🧹 SUBSCRIPTION NON VALIDA RIMOSSA`);
    console.log(`   Endpoint: ${endpoint.substring(0, 50)}...`);
    console.log(`   Codice errore: ${errorCode}`);
    console.log(`   Motivo: ${reason}`);
    console.log(`   Totale rimanenti: ${count}`);
  }
}

// Endpoint per inviare notifiche manuali (per test)
app.post('/sendNotification', async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'Title e body sono richiesti' });
    }
    const subs = await Subscription.find();
    const promises = subs.map(sub => 
      webpush.sendNotification(sub, JSON.stringify({ title, body }))
        .catch(err => {
          if (err.statusCode === 410) {
            cleanInvalidSubscription(sub.endpoint, 410, 'Subscription scaduta (Gone)');
          } else if (err.statusCode === 404) {
            cleanInvalidSubscription(sub.endpoint, 404, 'Endpoint non trovato');
          } else {
            const timestamp = new Date().toISOString();
            console.error(`[${timestamp}] ❌ ERRORE INVIO NOTIFICA:`, err);
            console.log(`   Endpoint: ${sub.endpoint.substring(0, 50)}...`);
            console.log(`   Codice errore: ${err.statusCode}`);
          }
        })
    );
    await Promise.all(promises);
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📢 NOTIFICA MANUALE INVIATA`);
    console.log(`   Titolo: ${title}`);
    console.log(`   Messaggio: ${body}`);
    console.log(`   Destinatari: ${subs.length} subscription`);
    res.status(200).json({ message: 'Notifica inviata con successo', title, body });
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERRORE INVIO NOTIFICA MANUALE:`, error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

const MQTT_BROKER = 'mqtt://test.mosquitto.org';
const MQTT_TOPIC = 'giardino/stato';

const mqttClient = mqtt.connect(MQTT_BROKER, {
  reconnectPeriod: 5000,
  connectTimeout: 30000
});

mqttClient.on('connect', () => {
  console.log('Connesso a MQTT broker');
  mqttClient.subscribe(MQTT_TOPIC);
});

mqttClient.on('error', (error) => {
  console.error('Errore MQTT:', error);
});

mqttClient.on('close', () => {
  console.log('Connessione MQTT chiusa');
});

mqttClient.on('message', async (topic, message) => {
  if (topic === MQTT_TOPIC) {
    try {
      const data = JSON.parse(message.toString());
      let title, body;
      if (data.stato === 'occupato') {
        title = '🚫 Giardino Occupato!';
        body = `Il giardino è stato occupato da ${data.famiglia} alle ${new Date(data.timestamp).toLocaleTimeString('it-IT')}`;
      } else {
        title = '✅ Giardino Libero!';
        body = `Il giardino è stato liberato da ${data.famiglia} alle ${new Date(data.timestamp).toLocaleTimeString('it-IT')}`;
      }
      const subs = await Subscription.find();
      const promises = subs.map(sub => 
        webpush.sendNotification(sub, JSON.stringify({ title, body }))
          .catch(err => {
            if (err.statusCode === 410) {
              cleanInvalidSubscription(sub.endpoint, 410, 'Subscription scaduta (Gone)');
            } else if (err.statusCode === 404) {
              cleanInvalidSubscription(sub.endpoint, 404, 'Endpoint non trovato');
            } else {
              const timestamp = new Date().toISOString();
              console.error(`[${timestamp}] ❌ ERRORE INVIO NOTIFICA MQTT:`, err);
              console.log(`   Endpoint: ${sub.endpoint.substring(0, 50)}...`);
              console.log(`   Codice errore: ${err.statusCode}`);
            }
          })
      );
      await Promise.all(promises);
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 📢 NOTIFICA MQTT INVIATA`);
      console.log(`   Titolo: ${title}`);
      console.log(`   Messaggio: ${body}`);
      console.log(`   Destinatari: ${subs.length} subscription`);
      console.log(`   Stato giardino: ${data.stato}`);
      console.log(`   Famiglia: ${data.famiglia}`);
    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] ❌ ERRORE PROCESSING MESSAGGIO MQTT:`, error);
    }
  }
});

// Utilizza la porta di Render o fallback su 4000
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Push server in ascolto su http://localhost:${PORT}`);
  console.log(`Health check disponibile su http://localhost:${PORT}/health`);
});