import Challenge from '../models/Challenge.mjs';
import UserService from './UserService.mjs';
import User from '../models/User';

class ChallengeService {
  static async create(obj) {
    const challenge = new Challenge(obj);
    challenge.save();
  }

  static async find(id) {
    return await Challenge
      .findById(id)
      .exec();
  }

  static async delete(_id) {
    return await Challenge
      .deleteOne({_id})
      .exec();
  }

  static async getAllByUserId(id) {
    const received = await Challenge
      .find({opponent: id})
      .lean()
      .exec();
    const sent = await Challenge
      .find({challenger: id})
      .lean()
      .exec();
    const recievedMapped = received.map(async (challenge) => {
      const challenger = await UserService.find(challenge.challenger);
      return {...challenge, challenger};
    });
    const sentMapped = sent.map(async (challenge) => {
      const opponent = await UserService.find(challenge.opponent);
      return {...challenge, opponent};
    });
    return Promise.all([
      Promise.all(recievedMapped),
      Promise.all(sentMapped),
    ]).then((complete) => (
      {received: complete[0], sent: complete[1]}
    ));
  }
}

export default ChallengeService;
