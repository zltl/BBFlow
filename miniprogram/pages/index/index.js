const app = getApp();

Page({
  data: {
    showWelcome: false,
    userInfo: null
  },

  onLoad() {
    this.checkFirstLaunch();
    this.loadUserInfo();
  },

  // 检查是否首次启动
  checkFirstLaunch() {
    const hasLaunched = wx.getStorageSync('hasLaunched');
    if (!hasLaunched) {
      this.setData({
        showWelcome: true
      });
    }
  },

  // 加载用户信息
  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({
        userInfo
      });
    }
  },

  // 关闭欢迎页
  closeWelcome() {
    wx.setStorageSync('hasLaunched', true);
    this.setData({
      showWelcome: false
    });
  },

  // 微信登录
  async handleLogin() {
    try {
      await app.login();
      await app.getUserInfo();
      
      wx.showToast({
        title: '登录成功',
        icon: 'success'
      });
      
      this.loadUserInfo();
    } catch (error) {
      console.error('登录失败:', error);
      wx.showToast({
        title: '登录失败',
        icon: 'none'
      });
    }
  },

  handleRecord() {
    wx.navigateTo({
      url: '/pages/record/record'
    });
  },

  handleHistory() {
    wx.navigateTo({
      url: '/pages/history/history'
    });
  }
});
