import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import webpush from 'web-push';
import mqtt from 'mqtt';
import mongoose from 'mongoose';
import Subscription from './subscription.model.js';
import Prenotazione from './prenotazione.model.js';
import dotenv from 'dotenv';
dotenv.config();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:tuamail@example.com';

webpush.setVapidDetails(
  VAPID_EMAIL,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connetti a MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI;
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

// Endpoint per visualizzare il log delle prenotazioni
app.get('/prenotazioni', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      famiglia, 
      stato, 
      dataInizio, 
      dataFine,
      sort = 'timestamp' 
    } = req.query;

    // Costruisci il filtro
    const filter = {};
    if (famiglia) filter.famiglia = { $regex: famiglia, $options: 'i' };
    if (stato) filter.stato = stato;
    if (dataInizio || dataFine) {
      filter.timestamp = {};
      if (dataInizio) filter.timestamp.$gte = new Date(dataInizio);
      if (dataFine) filter.timestamp.$lte = new Date(dataFine);
    }

    // Calcola skip per paginazione
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Esegui query con paginazione
    const prenotazioni = await Prenotazione.find(filter)
      .sort({ [sort]: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Conta totale documenti per paginazione
    const total = await Prenotazione.countDocuments(filter);

    // Calcola statistiche
    const stats = await Prenotazione.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalePrenotazioni: { $sum: 1 },
          totaleOccupato: {
            $sum: { $cond: [{ $eq: ['$stato', 'occupato'] }, 1, 0] }
          },
          totaleLibero: {
            $sum: { $cond: [{ $eq: ['$stato', 'libero'] }, 1, 0] }
          },
          durataMedia: { $avg: '$durata' }
        }
      }
    ]);

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📊 LOG PRENOTAZIONI CONSULTATO`);
    console.log(`   Filtri applicati:`, filter);
    console.log(`   Risultati: ${prenotazioni.length}/${total}`);

    res.json({
      prenotazioni,
      paginazione: {
        pagina: parseInt(page),
        limite: parseInt(limit),
        totale: total,
        pagine: Math.ceil(total / parseInt(limit))
      },
      statistiche: stats[0] || {
        totalePrenotazioni: 0,
        totaleOccupato: 0,
        totaleLibero: 0,
        durataMedia: 0
      }
    });
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERRORE CONSULTAZIONE LOG PRENOTAZIONI:`, error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Endpoint per ottenere statistiche delle prenotazioni
app.get('/prenotazioni/stats', async (req, res) => {
  try {
    const { dataInizio, dataFine } = req.query;
    
    const filter = {};
    if (dataInizio || dataFine) {
      filter.timestamp = {};
      if (dataInizio) filter.timestamp.$gte = new Date(dataInizio);
      if (dataFine) filter.timestamp.$lte = new Date(dataFine);
    }

    const stats = await Prenotazione.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
          },
          prenotazioni: { $sum: 1 },
          occupato: {
            $sum: { $cond: [{ $eq: ['$stato', 'occupato'] }, 1, 0] }
          },
          libero: {
            $sum: { $cond: [{ $eq: ['$stato', 'libero'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 30 } // ultimi 30 giorni
    ]);

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📈 STATISTICHE PRENOTAZIONI CONSULTATE`);

    res.json({ stats });
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERRORE STATISTICHE PRENOTAZIONI:`, error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Endpoint per forzare l'aggiornamento dello stato (utile dopo riavvio)
app.post('/forceStateUpdate', async (req, res) => {
  try {
    const { stato, famiglia, timestamp } = req.body;
    
    if (!stato || !famiglia) {
      return res.status(400).json({ error: 'Stato e famiglia sono richiesti' });
    }

    // Resetta il payload precedente per forzare l'aggiornamento
    lastMqttPayload = null;
    
    // Simula un messaggio MQTT
    const mockData = {
      stato,
      famiglia,
      timestamp: timestamp || new Date().toISOString()
    };
    
    // Salva la prenotazione
    let durata = null;
    if (stato === 'libero') {
      const ultimaOccupazione = await Prenotazione.findOne({
        famiglia: famiglia,
        stato: 'occupato'
      }).sort({ timestamp: -1 });
      
      if (ultimaOccupazione) {
        const oraAttuale = new Date(mockData.timestamp);
        const oraOccupazione = new Date(ultimaOccupazione.timestamp);
        durata = Math.round((oraAttuale - oraOccupazione) / (1000 * 60));
      }
    }

    await Prenotazione.create({
      timestamp: new Date(mockData.timestamp),
      famiglia: famiglia,
      stato: stato,
      durata: durata
    });

    // Invia notifica
    let title, body;
    if (stato === 'occupato') {
      title = '🚫 Giardino Occupato!';
      body = `Il giardino è stato occupato da ${famiglia} alle ${new Date(mockData.timestamp).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' })}`;
    } else {
      title = '✅ Giardino Libero!';
      body = `Il giardino è stato liberato da ${famiglia} alle ${new Date(mockData.timestamp).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' })}`;
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
            console.error(`[${timestamp}] ❌ ERRORE INVIO NOTIFICA FORZATA:`, err);
          }
        })
    );
    await Promise.all(promises);

    const logTimestamp = new Date().toISOString();
    console.log(`[${logTimestamp}] 🔄 STATO FORZATO AGGIORNATO`);
    console.log(`   Famiglia: ${famiglia}`);
    console.log(`   Stato: ${stato}`);
    console.log(`   Destinatari: ${subs.length} subscription`);

    res.status(200).json({ 
      message: 'Stato forzato aggiornato con successo',
      stato,
      famiglia,
      timestamp: mockData.timestamp
    });
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] ❌ ERRORE AGGIORNAMENTO STATO FORZATO:`, error);
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

// Configurazione MQTT tramite variabili d'ambiente
const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'wss://test.mosquitto.org:8081';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'giardino/stato';

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

// Variabile per memorizzare l'ultimo payload MQTT ricevuto
let lastMqttPayload = null;

mqttClient.on('message', async (topic, message) => {
  if (topic === MQTT_TOPIC) {
    try {
      const data = JSON.parse(message.toString());
      
      // Verifica se questo stato è già stato registrato nel database
      const ultimaPrenotazione = await Prenotazione.findOne({
        famiglia: data.famiglia,
        stato: data.stato
      }).sort({ timestamp: -1 });
      
      // Se esiste già una prenotazione con lo stesso stato per la stessa famiglia
      // e il timestamp è molto recente (entro 5 minuti), probabilmente è un duplicato
      if (ultimaPrenotazione) {
        const oraAttuale = new Date(data.timestamp);
        const oraUltima = new Date(ultimaPrenotazione.timestamp);
        const differenzaMinuti = Math.abs((oraAttuale - oraUltima) / (1000 * 60));
        
        if (differenzaMinuti < 5) {
          const timestamp = new Date().toISOString();
          console.log(`[${timestamp}] ⚠️ STATO DUPLICATO IGNORATO`);
          console.log(`   Famiglia: ${data.famiglia}`);
          console.log(`   Stato: ${data.stato}`);
          console.log(`   Differenza: ${differenzaMinuti.toFixed(1)} minuti`);
          return;
        }
      }

      // Confronta il payload attuale con quello precedente (per evitare duplicati durante la sessione)
      const currentPayload = JSON.stringify(data);
      if (lastMqttPayload === currentPayload) {
        // Se il payload è uguale al precedente, non inviare la notifica
        return;
      }
      // Aggiorna il payload precedente
      lastMqttPayload = currentPayload;

      // Salva la prenotazione nel database
      try {
        let durata = null;
        
        // Se lo stato è 'libero', cerca l'ultima prenotazione 'occupato' della stessa famiglia
        // per calcolare la durata
        if (data.stato === 'libero') {
          const ultimaOccupazione = await Prenotazione.findOne({
            famiglia: data.famiglia,
            stato: 'occupato'
          }).sort({ timestamp: -1 });
          
          if (ultimaOccupazione) {
            const oraAttuale = new Date(data.timestamp);
            const oraOccupazione = new Date(ultimaOccupazione.timestamp);
            durata = Math.round((oraAttuale - oraOccupazione) / (1000 * 60)); // durata in minuti
          }
        }

        await Prenotazione.create({
          timestamp: new Date(data.timestamp),
          famiglia: data.famiglia,
          stato: data.stato,
          durata: durata
        });

        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] 💾 PRENOTAZIONE SALVATA`);
        console.log(`   Famiglia: ${data.famiglia}`);
        console.log(`   Stato: ${data.stato}`);
        if (durata) console.log(`   Durata: ${durata} minuti`);
      } catch (dbError) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] ❌ ERRORE SALVATAGGIO PRENOTAZIONE:`, dbError);
      }

      let title, body;
      if (data.stato === 'occupato') {
        title = '🚫 Giardino Occupato!';
        body = `Il giardino è stato occupato da ${data.famiglia} alle ${new Date(data.timestamp).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' })}`;
      } else {
        title = '✅ Giardino Libero!';
        body = `Il giardino è stato liberato da ${data.famiglia} alle ${new Date(data.timestamp).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' })}`;
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