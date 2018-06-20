//
// Require all dependencies.
//
const express = require('express');
const expressSession = require('express-session');
const redis = require('redis');
const mongoose = require('mongoose');
const RedisStore = require('connect-redis')(expressSession);
const cookieParser = require('cookie-parser');
const http = require('http');
const Primus = require('primus');
const primusSession = require('./session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20');

let Secrets = {};

try {
  Secrets = require('./.secrets');
} catch (e) {
  Secrets = {
    appSecret: process.env.APP_SECRET,
    google: {
      id: process.env.GOOGLE_AUTH_ID,
      secret: process.env.GOOGLE_AUTH_SECRET,
    },
  };
}

const User = require('./models/User');

passport.use(new GoogleStrategy({
  clientID: Secrets.google.id,
  clientSecret: Secrets.google.secret,
  callbackURL: '/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
  User.findById(profile.id, function(err, user) {
    if (err) throw err;
    if (user === null) {
      const user = new User({
        _id: profile.id,
        username: profile.displayName,
        photo: profile.photos.length ? profile.photos[0].value : '',
      });
      user.save();
    }
  });
  done(null, profile);
}));

// config
const domainRoot = process.env.APP_SECRET ? 'sstk-tetris-ladder.surge.sh' : 'localhost:3000';
const mongoUri = process.env.MONGODB_URI || 'mongodb://mongo:27017/tetris';
const port  = process.env.PORT || 8080;

//
// Connect to MongoDb
//
mongoose.connect(mongoUri);

//
// Create an Express application.
//
const app = express();

//
// Configure and save a reference to the `cookie-parser` middleware so we can
// reuse it in Primus.
//
const secret = Secrets.appSecret || Math.random().toString(36);
const cookies = cookieParser(secret);

/* redis */
const rHost = process.env.REDIS_URL || process.env.REDIS_HOST || '127.0.0.1';
const rPort = 6379;
const client = process.env.REDIS_URL ? redis.createClient(rHost) : redis.createClient(rPort, rHost);
const store = new RedisStore({
  client,
  ttl: 15768000,
});

client.on('connect', () => {
  console.log(`redis connected - ${rHost}:${rPort}`);
});

//
// Add the middleware needed for session support.
//
app.use(cookies);
app.use(expressSession({
  saveUninitialized: true,
  secret,
  resave: true,
  store,
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  // placeholder for custom user serialization
  // null is for errors
  done(null, user);
});

passport.deserializeUser((user, done) => {
  // placeholder for custom user deserialization.
  // null is for errors
  done(null, user);
});

app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile'],
}));

app.get(
  '/auth/google/callback',
  passport.authenticate('google'),
  (req, res) => {
    res.redirect(`//${domainRoot}/leaderboard`);
  },
);

app.get('/', (req, res) => {
  //
  // Every time that we visit the index page we update the session with a new
  // timestamp.
  //
  req.session.timestamp = Date.now();
  res.sendFile(`${__dirname}/index.html`);
});

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect(`//${domainRoot}`);
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).send({
    error: 'Unauthenticated',
  });
}

app.get('/protected', ensureAuthenticated, (req, res) => {
  res.send('access granted');
});

//
// Create an HTTP server and our Primus server.
//
const server = http.createServer(app);
const primus = new Primus(server);

//
// Here we add the `cookie-parser` middleware and our session middleware. The
// first will populate `req.signedCookies` and the second `req.session` for the
// requests captured by Primus.
//
primus.use('cookies', cookies);
primus.use('session', primusSession, {
  store,
});

primus.on('connection', async (spark) => {
  if (spark.request.session.passport && spark.request.session.passport.user) {
    const {
      user,
    } = spark.request.session.passport;
    spark.write({
      action: 'persist.player',
      payload: user,
    });
    primus.write({
      action: 'persist.leaderboard',
      payload: await getLeaderboard(),
    });
    spark.on('data', async (event) => {
      const {
        payload,
      } = event;
      console.log(event.type);
      switch (event.type) {
        case 'leaderboard.get':
          spark.write({
            action: 'persist.leaderboard',
            payload: await getLeaderboard(),
          });
          break;
        case 'notify.generic':
          primus.write({
            action: event.type,
            payload: event.payload,
          });
          break;
        case 'player.joinGame':
          const game = Games.find((game) => game.id === payload.id);
          if (game) {
            game.join(player);
          }
          break;
        case 'game.create':
          Games.push(new Game(payload.name, payload.cardpacks, player.nickname, payload.password));
          spark.write({
            action: 'save.lobbies',
            payload: filterEntities(Games),
          });
          break;
        case 'player.submit':
          playerGame = findPlayerGame(player.id);
          if (playerGame) {
            playerGame.submitCard(player, payload.index);
          }
          break;
        case 'czar.judge':
          playerGame = findPlayerGame(player.id);
          if (playerGame && playerGame.currentRound.cardCzar.id === player.id) {
            const {currentRound} = playerGame;
            currentRound.winner = currentRound.submissionMap.get(payload.id);
            playerGame.endRound();
          }
          break;
      }
    });
  }
});

async function getLeaderboard() {
  return await User
    .find()
    .sort({ranking: -1})
    .exec();
}

//
// Begin accepting connections.
//
server.listen(port, () => {
  console.log(`Open ${domainRoot}:${port} in your browser`);
});
