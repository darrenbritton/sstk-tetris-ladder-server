import User from '../models/User.mjs';
import EloRank from 'elo-rank';

const elo = new EloRank();

class UserService {
  static async create(obj) {
    const user = new User(obj);
    await user.save();
  }

  static async find(id) {
    return await User
      .findById(id)
      .exec();
  }

  static async update(id, obj) {
    await User
      .findByIdAndUpdate(id, {$set: obj})
      .exec();
  }

  static async getLeaderboard() {
    return await User
      .find()
      .sort({ranking: -1})
      .exec();
  }

  static async updateRankings(winnerId, loserId) {
    const winner = await UserService.find(winnerId);
    const loser = await UserService.find(loserId);
    const winnerRank = elo.updateRating(elo.getExpected(winner.rank, loser.rank), 1, winner.rank);
    const loserRank = elo.updateRating(elo.getExpected(loser.rank, winner.rank), 0, loser.rank);
    await UserService.update(winnerId, {rank: winnerRank, gamesPlayed: winner.gamesPlayed + 1});
    return await UserService.update(loserId, {rank: loserRank, gamesPlayed: loser.gamesPlayed + 1});
  }
}

export default UserService;
