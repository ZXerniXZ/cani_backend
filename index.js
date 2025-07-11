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

// Funzione per pulire subscription non valide
function cleanInvalidSubscription(endpoint, errorCode, reason) {
  const timestamp = new Date().toISOString();
  const initialCount = subscriptions.length;
  
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  const finalCount = subscriptions.length;
  
  if (initialCount > finalCount) {
    saveSubscriptions();
    console.log(`[${timestamp}] 🧹 SUBSCRIPTION NON VALIDA RIMOSSA`);
    console.log(`   Endpoint: ${endpoint.substring(0, 50)}...`);
    console.log(`   Codice errore: ${errorCode}`);
    console.log(`   Motivo: ${reason}`);
    console.log(`   Totale rimanenti: ${finalCount}`);
  }
}

app.post('/subscribe', (req, res) => {
  try {
    const sub = req.body;
    const timestamp = new Date().toISOString();
    
    if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
      subscriptions.push(sub);
      saveSubscriptions();
      console.log(`[${timestamp}] ✅ NUOVA SUBSCRIPTION REGISTRATA`);
      console.log(`   Endpoint: ${sub.endpoint.substring(0, 50)}...`);
      console.log(`   Totale subscription: ${subscriptions.length}`);
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
app.delete('/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    const timestamp = new Date().toISOString();
    
    const initialCount = subscriptions.length;
    subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
    const finalCount = subscriptions.length;
    
    if (initialCount > finalCount) {
      saveSubscriptions();
      console.log(`[${timestamp}] 🗑️ SUBSCRIPTION RIMOSSA`);
      console.log(`   Endpoint: ${endpoint.substring(0, 50)}...`);
      console.log(`   Subscription rimosse: ${initialCount - finalCount}`);
      console.log(`   Totale rimanenti: ${finalCount}`);
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

// Endpoint per inviare notifiche manuali (per test)
app.post('/sendNotification', (req, res) => {
  try {
    const { title, body } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({ error: 'Title e body sono richiesti' });
    }
    
    const promises = subscriptions.map(sub => 
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
    
    Promise.all(promises).then(() => {
      console.log('Notifica manuale inviata:', title, body);
      res.status(200).json({ message: 'Notifica inviata con successo', title, body });
    });
  } catch (error) {
    console.error('Errore nell\'invio della notifica manuale:', error);
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
        title = '🚫 Giardino Occupato!';
        body = `Il giardino è stato occupato da ${data.famiglia} alle ${new Date(data.timestamp).toLocaleTimeString('it-IT')}`;
      } else {
        title = '✅ Giardino Libero!';
        body = `Il giardino è stato liberato da ${data.famiglia} alle ${new Date(data.timestamp).toLocaleTimeString('it-IT')}`;
      }
      
      const promises = subscriptions.map(sub => 
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
      
      Promise.all(promises).then(() => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] 📢 NOTIFICA MQTT INVIATA`);
        console.log(`   Titolo: ${title}`);
        console.log(`   Messaggio: ${body}`);
        console.log(`   Destinatari: ${subscriptions.length} subscription`);
        console.log(`   Stato giardino: ${data.stato}`);
        console.log(`   Famiglia: ${data.famiglia}`);
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