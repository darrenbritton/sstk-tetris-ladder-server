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
    return await Game
      .findByIdAndUpdate(id, {$set: obj}, {new: true})
      .exec();
  }

  static async getPending() {
    return await Game
      .find({played: false})
      .sort({created_at: -1})
      .exec();
  }

  static async getRecentResults() {
    return await Game
      .find({played: true})
      .limit(10)
      .sort({created_at: -1})
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
