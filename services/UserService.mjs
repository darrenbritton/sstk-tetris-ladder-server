import User from '../models/User.mjs';

class UserService {
  static async create(obj) {
    const user = new User(obj);
    user.save();
  }

  static async find(id) {
    return await User
      .findById(id)
      .exec();
  }

  static async getLeaderboard() {
    return await User
      .find()
      .sort({ranking: -1})
      .exec();
  }
}

export default UserService;
