const app = getApp();

Page({
  data: {
    showWelcome: false,
    userInfo: null
  },

  onLoad() {
    this.checkFirstLaunch();
    this.loadUserInfo();
    this.autoLogin();
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
  handleLogin() {
    // getUserProfile必须在点击事件中直接调用，不能在异步回调中
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        // 保存用户信息
        const userInfo = res.userInfo;
        wx.setStorageSync('userInfo', userInfo);
        wx.setStorageSync('hasAuth', true);
        
        this.setData({
          userInfo
        });
        
        wx.showToast({
          title: '登录成功',
          icon: 'success'
        });
        
        // 然后执行wx.login获取code
        app.login();
      },
      fail: (error) => {
        console.error('登录失败:', error);
        wx.showToast({
          title: '登录失败',
          icon: 'none'
        });
      }
    });
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
