// app.ts
import { request } from './utils/request';

App<IAppOption>({
  globalData: {},
  onLaunch() {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 登录
    wx.login({
      success: res => {
        console.log('wx.login code:', res.code)
        if (res.code) {
          // 发起网络请求
          request<{ openid: string }>({
            url: '/auth/login',
            method: 'POST',
            data: {
              code: res.code
            }
          }).then(data => {
            console.log('Login success:', JSON.stringify(data));
            wx.setStorageSync('openid', data.openid);
          }).catch(err => {
            console.error('Login failed:', err);
            // Fallback for offline/demo mode if server is not running
            if (!wx.getStorageSync('openid')) {
               console.log('Using mock openid for offline mode');
               wx.setStorageSync('openid', 'offline_user_' + Date.now());
            }
          });
        }
      },
    })
  },
})