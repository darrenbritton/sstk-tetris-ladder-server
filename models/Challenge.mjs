import mongoose from 'mongoose';

const Schema = mongoose.Schema;

const challengeSchema = new Schema({
  challenger: {type: String, require: true},
  opponent: {type: String, require: true},
  created_at: {type: Date, default: Date.now()},
});

const Challenge = mongoose.model('Challenge', challengeSchema);

export default Challenge;
