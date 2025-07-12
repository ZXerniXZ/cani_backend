import mongoose from 'mongoose';

const prenotazioneSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  famiglia: {
    type: String,
    required: true
  },
  stato: {
    type: String,
    enum: ['occupato', 'libero'],
    required: true
  },
  durata: {
    type: Number, // durata in minuti
    default: null
  },
  note: {
    type: String,
    default: ''
  }
}, {
  timestamps: true // aggiunge automaticamente createdAt e updatedAt
});

// Indice per ottimizzare le query per data
prenotazioneSchema.index({ timestamp: -1 });
prenotazioneSchema.index({ famiglia: 1 });
prenotazioneSchema.index({ stato: 1 });

export default mongoose.model('Prenotazione', prenotazioneSchema); 