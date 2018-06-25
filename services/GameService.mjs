import Game from '../models/Game.mjs';

class GameService {
  static async create(obj) {
    const game = new Game(obj);
    await game.save();
  }

  static async find(id) {
    return await Game
      .findById(id)
      .exec();
  }

  static async update(id, obj) {
    await Game
      .findByIdAndUpdate(id, {$set: obj})
      .exec();
    return GameService.find(id);
  }

  static async getPending() {
    return await Game
      .find({played: false})
      .sort({createdAt: 1})
      .exec();
  }

  static async getRecentResults() {
    return await Game
      .find({played: true})
      .sort({createdAt: 1})
      .limit(10)
      .exec();
  }

  static async getView() {
    return {
      pending: await GameService.getPending(),
      recent: await GameService.getRecentResults(),
    };
  }

  static async playerGameInProgress(id) {
    return await Game
      .findOne({inProgress: true, $or: [{'challenger': id}, {'opponent': id}]})
      .exec();
  }
}

export default GameService;
