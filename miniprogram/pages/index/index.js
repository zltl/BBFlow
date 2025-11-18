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
    console.log('loadUserInfo -> userInfo:', userInfo);
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
        console.log('handleLogin -> userInfo:', JSON.stringify(res));
        wx.setStorageSync('userInfo', userInfo);
        wx.setStorageSync('hasAuth', true);
        
        this.setData({
          userInfo
        });
        
        wx.showToast({
          title: '登录成功',
          icon: 'success'
        });
        
        this.fetchSensitiveUserData(res);

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

  // 自动登录尝试
  autoLogin() {
    const hasAuth = wx.getStorageSync('hasAuth');
    console.log('autoLogin -> hasAuth:', hasAuth);
    if (!hasAuth) {
      console.log('autoLogin -> 用户未授权，跳过自动登录');
      return;
    }

    const cachedUserInfo = wx.getStorageSync('userInfo');
    console.log('autoLogin -> cachedUserInfo:', cachedUserInfo);
    if (cachedUserInfo && !this.data.userInfo) {
      this.setData({
        userInfo: cachedUserInfo
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
  },

  // 云调用获取开放数据中的敏感信息
  fetchSensitiveUserData(res) {
    if (!wx.cloud) {
      console.warn('fetchSensitiveUserData -> 当前环境未初始化云能力');
      return;
    }

    const cloudID = res && res.cloudID;
    if (!cloudID) {
      console.warn('fetchSensitiveUserData -> 未获取到 cloudID，无法解密敏感数据');
      return;
    }

    wx.cloud.callFunction({
      name: 'getOpenData',
      data: {
        list: [cloudID]
      }
    }).then(({ result }) => {
      if (result && result.errCode === 0) {
        console.log('fetchSensitiveUserData -> res:', result.data);
      } else {
        console.warn('fetchSensitiveUserData -> 云函数返回异常:', result);
      }
    }).catch((error) => {
      console.error('fetchSensitiveUserData -> 调用云函数失败:', error);
    });
  }
});
