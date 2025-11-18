App({
  globalData: {
    userInfo: null,
    hasAuth: false
  },

  onLaunch() {
    console.log('安压宝小程序启动');
    if (!wx.cloud) {
      console.error('当前基础库版本过低，请升级以使用云能力');
    } else {
      wx.cloud.init({
        traceUser: true
      });
    }
    this.checkAuth();
  },

  // 检查授权状态
  checkAuth() {
    const hasAuth = wx.getStorageSync('hasAuth');
    this.globalData.hasAuth = hasAuth;
  },

  // 微信登录
  login() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => {
          if (res.code) {
            console.log('登录成功，res ->', JSON.stringify(res));
            // 实际项目中需要发送code到后端换取openid
            // 这里简化处理，仅标记已登录
            wx.setStorageSync('hasAuth', true);
            this.globalData.hasAuth = true;
            resolve(res.code);
          } else {
            reject(new Error('登录失败'));
          }
        },
        fail: reject
      });
    });
  },

  // 获取用户信息（注意：getUserProfile必须在页面点击事件中直接调用）
  getUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      return Promise.resolve(userInfo);
    }
    return Promise.reject(new Error('未登录'));
  }
});
