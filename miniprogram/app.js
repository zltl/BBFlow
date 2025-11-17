App({
  globalData: {
    userInfo: null,
    hasAuth: false
  },

  onLaunch() {
    console.log('安压宝小程序启动');
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
            console.log('登录成功，code:', res.code);
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

  // 获取用户信息
  getUserInfo() {
    return new Promise((resolve, reject) => {
      wx.getUserProfile({
        desc: '用于完善用户资料',
        success: (res) => {
          this.globalData.userInfo = res.userInfo;
          wx.setStorageSync('userInfo', res.userInfo);
          resolve(res.userInfo);
        },
        fail: reject
      });
    });
  }
});
