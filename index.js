import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import webpush from 'web-push';
import mqtt from 'mqtt';
import fs from 'fs';

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

// Health check endpoint per Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Push server is running' });
});

// Endpoint per ottenere la chiave pubblica VAPID
app.get('/vapidPublicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Endpoint per visualizzare le subscription attuali
app.get('/subscriptions', (req, res) => {
  res.json({ 
    count: subscriptions.length,
    subscriptions: subscriptions 
  });
});

const SUBSCRIPTIONS_FILE = './subscriptions.json';

let subscriptions = [];
if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
  try {
    subscriptions = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE));
    console.log('=== SUBSCRIPTIONS.JSON CARICATO ===');
    console.log('Contenuto iniziale:');
    console.log(JSON.stringify(subscriptions, null, 2));
    console.log('===================================');
  } catch (error) {
    console.error('Errore nel caricamento delle sottoscrizioni:', error);
    subscriptions = [];
  }
} else {
  console.log('=== SUBSCRIPTIONS.JSON NON TROVATO ===');
  console.log('Creazione nuovo file subscriptions.json');
  console.log('=======================================');
}

function saveSubscriptions() {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
    console.log('=== SUBSCRIPTIONS.JSON AGGIORNATO ===');
    console.log('Contenuto attuale:');
    console.log(JSON.stringify(subscriptions, null, 2));
    console.log('=====================================');
  } catch (error) {
    console.error('Errore nel salvataggio delle sottoscrizioni:', error);
  }
}

app.post('/subscribe', (req, res) => {
  try {
    const sub = req.body;
    if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
      subscriptions.push(sub);
      saveSubscriptions();
      console.log('Nuova subscription registrata');
    }
    res.status(201).json({ message: 'Subscription registrata con successo' });
  } catch (error) {
    console.error('Errore nella registrazione della subscription:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Endpoint per rimuovere una subscription
app.delete('/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
    saveSubscriptions();
    console.log('Subscription rimossa');
    res.status(200).json({ message: 'Subscription rimossa con successo' });
  } catch (error) {
    console.error('Errore nella rimozione della subscription:', error);
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

mqttClient.on('message', (topic, message) => {
  if (topic === MQTT_TOPIC) {
    try {
      const data = JSON.parse(message.toString());
      let title, body;
      if (data.stato === 'occupato') {
        title = 'Giardino occupato';
        body = `Occupato da ${data.famiglia} dal ${new Date(data.timestamp).toLocaleString()}`;
      } else {
        title = 'Giardino libero';
        body = `Liberato da ${data.famiglia} il ${new Date(data.timestamp).toLocaleString()}`;
      }
      
      const promises = subscriptions.map(sub => 
        webpush.sendNotification(sub, JSON.stringify({ title, body }))
          .catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              console.log('Subscription scaduta, rimuovendo...');
              subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
              saveSubscriptions();
            } else {
              console.error('Errore nell\'invio della notifica:', err);
            }
          })
      );
      
      Promise.all(promises).then(() => {
        console.log('Notifica inviata a tutte le subscription:', title, body);
      });
    } catch (error) {
      console.error('Errore nel processing del messaggio MQTT:', error);
    }
  }
});

// Utilizza la porta di Render o fallback su 4000
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Push server in ascolto su http://localhost:${PORT}`);
  console.log(`Health check disponibile su http://localhost:${PORT}/health`);
});