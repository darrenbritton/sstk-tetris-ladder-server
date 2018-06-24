import Game from '../models/Game.mjs';

class GameService {
  static async create(obj) {
    const game = new Game(obj);
    game.save();
  }

  static async getPlayable() {
    return await Game
      .find({played: false, inProgress: false})
      .sort({createdAt: -1})
      .exec();
  }

  static async getRecentResults() {
    return await Game
      .find({played: true})
      .sort({createdAt: -1})
      .exec();
  }

  static async getView() {
    return {
      pending: await GameService.getPlayable(),
      recent: await GameService.getRecentResults(),
    };
  }
}

export default GameService;
