class NotificationService {
  static generate(text, action = '', actionText = '') {
    return {
      action: 'notify.generic',
      payload: {text, action, actionText},
    };
  }
}

export default NotificationService;
