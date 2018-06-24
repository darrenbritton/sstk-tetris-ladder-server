class NotificationService {
  static generate(text, action = '') {
    return {
      action: 'notify.generic',
      payload: {text, action},
    };
  }
}

export default NotificationService;
