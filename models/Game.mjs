import mongoose from 'mongoose';

const Schema = mongoose.Schema;

const gameSchema = new Schema({
  challenger: {type: String, require: true},
  opponent: {type: String, require: true},
  played: {type: Boolean, default: false},
  inProgress: {type: Boolean, default: false},
  winner: String,
  contested: {type: Boolean, default: false},
  waitingForConfirmationFrom: String,
  created_at: {type: Date, default: Date.now()},
  played_at: Date,
});

const Game = mongoose.model('Game', gameSchema);

export default Game;
