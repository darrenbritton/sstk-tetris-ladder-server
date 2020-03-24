//
// Require all dependencies.
//
import express from 'express';
import path from 'path';
import expressSession from 'express-session';
import redis from 'redis';
import mongoose from 'mongoose';
import redisStoreFactory from 'connect-redis';
const RedisStore = redisStoreFactory(expressSession);
import cookieParser from 'cookie-parser';
import http from 'http';
import Primus from 'primus';
import primusSession from './session';
import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import jsonfile from 'jsonfile';

let Secrets = {};

try {
  Secrets = jsonfile.readFileSync('.secrets.json');
} catch (e) {
  Secrets = {
    appSecret: process.env.APP_SECRET,
    google: {
      id: process.env.GOOGLE_AUTH_ID,
      secret: process.env.GOOGLE_AUTH_SECRET,
    },
  };
}


// Services
import ChallengeService from './services/ChallengeService.mjs';
import GameService from './services/GameService.mjs';
import UserService from './services/UserService.mjs';
import NotificationService from './services/NotificationService.mjs';

passport.use(new GoogleStrategy({
  clientID: Secrets.google.id,
  clientSecret: Secrets.google.secret,
  callbackURL: '/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
    const user = await UserService.find(profile.id);
    if (user === null) {
      UserService.create({
        _id: profile.id,
        username: profile.displayName,
        photo: profile.photos.length ? profile.photos[0].value : '',
      });
    }
    done(null, profile);
}));

// config
const domainRoot = process.env.APP_SECRET ? 'sstk-tetris.netlify.com' : 'localhost:3000';
const mongoUri = process.env.MONGODB_URI || 'mongodb://mongo:27017/tetris';
const port = process.env.PORT || 8080;

//
// Connect to MongoDb
//
mongoose.connect(mongoUri, {poolSize: 10});

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
  res.sendFile(`${path.resolve()}/index.html`);
});

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect(`//${domainRoot}/logged-out`);
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
const sparkMap = {};

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
    sparkMap[user.id] = spark;
    spark.write({
      action: 'persist.player',
      payload: user,
    });
    spark.write({
      action: 'persist.challenges',
      payload: await ChallengeService.getAllByUserId(user.id),
    });
    primus.write({
      action: 'persist.leaderboard',
      payload: await UserService.getLeaderboard(),
    });
    primus.write({
      action: 'persist.games',
      payload: await GameService.getView(),
    });
    const game = await GameService.playerGameInProgress(user.id);
    if (game) {
      primus.write({
        action: 'persist.playing',
        payload: game,
      });
      spark.write({
        action: 'display.togglePlayDialog',
        payload: {},
      });
    }
    spark.on('data', async (event) => {
      const {
        payload,
      } = event;
      let challenge;
      let game;
      console.log(event.type);
      switch (event.type) {
        case 'leaderboard.get':
          spark.write({
            action: 'persist.leaderboard',
            payload: await UserService.getLeaderboard(),
          });
          break;
        case 'notify.generic':
          primus.write({
            action: event.type,
            payload: payload,
          });
          break;
        case 'player.challenge':
          if (payload.opponent === user.id) {
            spark.write(NotificationService.generate(`You can't challenge yourself!`));
          } else {
            const opponent = await UserService.find(payload.opponent);
            if (opponent) { // issue here somewhere
              await ChallengeService.create({
                challenger: user.id,
                opponent: opponent._id,
              });
              spark.write({
                action: 'persist.challenges',
                payload: await ChallengeService.getAllByUserId(user.id),
              });
              spark.write(NotificationService.generate(`${opponent.username} has been sent your challenge!`, 'challenge.view', 'view'));
              if (sparkMap[opponent._id]) {
                sparkMap[opponent._id].write(NotificationService.generate(`${user.displayName} has sent you a challenge!`, 'challenge.view', 'view'));
                sparkMap[opponent._id].write({
                  action: 'persist.challenges',
                  payload: await ChallengeService.getAllByUserId(opponent._id),
                });
              }
            } else {
              spark.write(NotificationService.generate(`this opponent no longer exists!`));
            }
          }
          break;
        case 'challenge.accept':
          challenge = await ChallengeService.find(payload.id);
          if (challenge !== null) {
            const {challenger, opponent} = challenge;
            if (opponent === user.id) {
              await GameService.create({
                challenger,
                opponent,
              });
              await ChallengeService.delete(payload.id);
              spark.write(NotificationService.generate(`Challenge Accepted!`, 'game.view', 'view'));
              if (sparkMap[challenger]) {
                sparkMap[challenger].write(NotificationService.generate(`${user.displayName} has accepted your challenge!`, 'game.view', 'view'));
                sparkMap[challenger].write({
                  action: 'persist.challenges',
                  payload: await ChallengeService.getAllByUserId(challenger),
                });
              }
              primus.write({
                action: 'persist.games',
                payload: await GameService.getView(),
              });
            } else {
              spark.write(NotificationService.generate(`you can only accept games you have been challenged to!`));
            }
          } else {
            spark.write(NotificationService.generate(`this challenge no longer exists!`));
          }
          spark.write({
            action: 'persist.challenges',
            payload: await ChallengeService.getAllByUserId(user.id),
          });
          break;
        case 'challenge.reject':
          challenge = await ChallengeService.find(payload.id);
          if (challenge !== null) {
            const {challenger, opponent} = challenge;
            if (opponent === user.id) {
              await ChallengeService.delete(payload.id);
              spark.write(NotificationService.generate(`Challenge Rejected!`));
              if (sparkMap[challenger]) {
                sparkMap[challenger].write(NotificationService.generate(`${user.displayName} has rejected your challenge!`));
                sparkMap[challenger].write({
                  action: 'persist.challenges',
                  payload: await ChallengeService.getAllByUserId(challenger),
                });
              }
              primus.write({
                action: 'persist.games',
                payload: await GameService.getView(),
              });
            } else {
              spark.write(NotificationService.generate(`you can only reject games you have been challenged to!`));
            }
          } else {
            spark.write(NotificationService.generate(`this challenge no longer exists!`));
          }
          spark.write({
            action: 'persist.challenges',
            payload: await ChallengeService.getAllByUserId(user.id),
          });
          break;
        case 'game.initiate':
          game = await GameService.find(payload.id);
          let closeDialog = false;
          if (game !== null) {
            const {challenger, opponent} = game;
            const otherPlayer = challenger === user.id ? opponent : opponent === user.id ? challenger : null;
            if (otherPlayer) {
              if (sparkMap[otherPlayer]) {
                sparkMap[otherPlayer].write({
                  action: 'display.gamePrompt',
                  payload: game,
                });
              } else {
                spark.write(NotificationService.generate(`your opponent must be online to start a game!`));
                closeDialog = true;
              }
            } else {
              spark.write(NotificationService.generate(`you can only initiate games you are involved in!`));
              closeDialog = true;
            }
          } else {
            spark.write(NotificationService.generate(`this game no longer exists!`));
            closeDialog = true;
          }
          if (closeDialog) {
            spark.write({
              action: 'display.togglePlayDialog',
              payload: {},
            });
          }
          primus.write({
            action: 'persist.games',
            payload: await GameService.getView(),
          });
          break;
        case 'game.accept':
          game = await GameService.find(payload.id);
          if (game !== null) {
            const {challenger, opponent} = game;
            const otherPlayer = challenger === user.id ? opponent : opponent === user.id ? challenger : null;
            if (otherPlayer) {
              if (sparkMap[otherPlayer]) {
                game = await GameService.update(payload.id, {inProgress: true});
                sparkMap[otherPlayer].write({
                  action: 'persist.playing',
                  payload: game,
                });
                spark.write({
                  action: 'persist.playing',
                  payload: game,
                });
              }
            } else {
              spark.write(NotificationService.generate(`you can only accept games you are involved in!`));
            }
          } else {
            spark.write(NotificationService.generate(`this game no longer exists!`));
          }
          primus.write({
            action: 'persist.games',
            payload: await GameService.getView(),
          });
          break;
        case 'game.reject':
          game = await GameService.find(payload.id);
          if (game !== null) {
            const {challenger, opponent} = game;
            const otherPlayer = challenger === user.id ? opponent : opponent === user.id ? challenger : null;
            if (otherPlayer) {
              if (sparkMap[otherPlayer]) {
                sparkMap[otherPlayer].write({
                  action: 'persist.playing',
                  payload: {},
                });
                sparkMap[otherPlayer].write({
                  action: 'display.togglePlayDialog',
                  payload: {},
                });
                sparkMap[otherPlayer].write({
                  action: 'notify.generic',
                  payload: {text: `${user.displayName} has rejected your request to start a game`},
                });
                spark.write({
                  action: 'persist.playing',
                  payload: {},
                });
              }
            } else {
              spark.write(NotificationService.generate(`you can only reject games you are involved in!`));
            }
          } else {
            spark.write(NotificationService.generate(`this game no longer exists!`));
          }
          break;
        case 'game.win':
          game = await GameService.find(payload.id);
          if (game !== null) {
            const {challenger, opponent} = game;
            const otherPlayer = challenger === user.id ? opponent : opponent === user.id ? challenger : null;
            if (otherPlayer) {
              if (sparkMap[otherPlayer]) {
                game = await GameService.update(payload.id, {winner: user.id, waitingForConfirmationFrom: otherPlayer});
                sparkMap[otherPlayer].write({
                  action: 'persist.playing',
                  payload: {...game._doc},
                });
                spark.write({
                  action: 'persist.playing',
                  payload: game,
                });
              } else {
                spark.write(NotificationService.generate(`you can't declare yourself the winner while the other play is offline!`));
              }
            } else {
              spark.write(NotificationService.generate(`you can only win games you are involved in!`));
            }
          } else {
            spark.write(NotificationService.generate(`this game no longer exists!`));
          }
          break;
        case 'game.lose':
          game = await GameService.find(payload.id);
          if (game !== null) {
            const {challenger, opponent} = game;
            const otherPlayer = challenger === user.id ? opponent : opponent === user.id ? challenger : null;
            if (otherPlayer) {
              if (sparkMap[otherPlayer]) {
                game = await GameService.update(payload.id, {winner: otherPlayer, waitingForConfirmationFrom: otherPlayer});
                sparkMap[otherPlayer].write({
                  action: 'persist.playing',
                  payload: {...game._doc},
                });
                spark.write({
                  action: 'persist.playing',
                  payload: game,
                });
              } else {
                spark.write(NotificationService.generate(`you can't declare yourself the loser while the other play is offline!`));
              }
            } else {
              spark.write(NotificationService.generate(`you can only lose games you are involved in!`));
            }
          } else {
            spark.write(NotificationService.generate(`this game no longer exists!`));
          }
          break;
        case 'game.confirm':
          game = await GameService.find(payload.id);
          if (game !== null) {
            const {challenger, opponent} = game;
            const otherPlayer = challenger === user.id ? opponent : opponent === user.id ? challenger : null;
            if (otherPlayer) {
              if (sparkMap[otherPlayer]) {
                game = await GameService.update(payload.id, {played: true, inProgress: false, waitingForConfirmationFrom: ''});
                const loser = game.winner === otherPlayer ? user.id : otherPlayer;
                await UserService.updateRankings(game.winner, loser);
                sparkMap[otherPlayer].write({
                  action: 'persist.playing',
                  payload: {},
                });
                spark.write({
                  action: 'persist.playing',
                  payload: {},
                });
                sparkMap[otherPlayer].write({
                  action: 'display.togglePlayDialog',
                  payload: {},
                });
                sparkMap[game.winner].write(NotificationService.generate('You Won! your leaderboard ranking has been updated', 'leaderboard.view', 'view'));
                sparkMap[loser].write(NotificationService.generate('You Lost! your leaderboard ranking has been updated', 'leaderboard.view', 'view'));
                primus.write({
                  action: 'persist.leaderboard',
                  payload: await UserService.getLeaderboard(),
                });
                primus.write({
                  action: 'persist.games',
                  payload: await GameService.getView(),
                });
              } else {
                spark.write(NotificationService.generate(`you can't confirm the result while the other play is offline!`));
              }
            } else {
              spark.write(NotificationService.generate(`you can only confirm games you are involved in!`));
            }
          } else {
            spark.write(NotificationService.generate(`this game no longer exists!`));
          }
          break;
        case 'game.contest':
          game = await GameService.find(payload.id);
          if (game !== null) {
            const {challenger, opponent} = game;
            const otherPlayer = challenger === user.id ? opponent : opponent === user.id ? challenger : null;
            if (otherPlayer) {
              if (sparkMap[otherPlayer]) {
                game = await GameService.update(payload.id, {played: true, contested: true, inProgress: false, waitingForConfirmationFrom: ''});
                sparkMap[otherPlayer].write({
                  action: 'persist.playing',
                  payload: {},
                });
                sparkMap[otherPlayer].write({
                  action: 'display.togglePlayDialog',
                  payload: {},
                });
                spark.write({
                  action: 'persist.playing',
                  payload: {},
                });
                const notification = NotificationService.generate('Result was contested! game will have no ranking effect and is now hidden');
                sparkMap[otherPlayer].write(notification);
                spark.write(notification);
                primus.write({
                  action: 'persist.games',
                  payload: await GameService.getView(),
                });
              } else {
                spark.write(NotificationService.generate(`you can't contest the result while the other play is offline!`));
              }
            } else {
              spark.write(NotificationService.generate(`you can only contest games you are involved in!`));
            }
          } else {
            spark.write(NotificationService.generate(`this game no longer exists!`));
          }
          break;
      }
    });
  }
});

primus.on('disconnection', (spark) => {
  if (spark.request.session.passport && spark.request.session.passport.user) {
    const {
      user,
    } = spark.request.session.passport;
    delete sparkMap[user.id];
  }
});

//
// Begin accepting connections.
//
server.listen(port, () => {
  console.log(`Open ${domainRoot} in your browser`);
});
