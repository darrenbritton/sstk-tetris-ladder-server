const mongoose = require('mongoose');
const constants = require('../constants');

const Schema = mongoose.Schema;

const userSchema = new Schema({
    _id: String,
    username: {type: String, required: true, unique: true},
    photo: String,
    admin: Boolean,
    rank: {type: Number, default: constants.startingElo},
    gamesPlayed: {type: Number, default: 0},
    created_at: Date,
    updated_at: Date,
});

const User = mongoose.model('User', userSchema);

module.exports = User;
