// app.ts
import { request } from './utils/request';
import { API_ENDPOINTS } from './config';

App<IAppOption>({
  globalData: {},
  onLaunch(options) {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // Save launch params for later processing
    if (options && options.query) {
      if (options.query.activate) {
        wx.setStorageSync('pending_activate', options.query.activate);
      }
      if (options.query.invite) {
        wx.setStorageSync('pending_invite', options.query.invite);
      }
    }

    // 登录
    wx.login({
      success: res => {
        console.log('wx.login code:', res.code)
        if (res.code) {
          // 发起网络请求
          request<{ openid: string, token: string }>({
            url: API_ENDPOINTS.AUTH_LOGIN,
            method: 'POST',
            data: {
              code: res.code
            }
          }).then(data => {
            console.log('Login success:', JSON.stringify(data));
            wx.setStorageSync('openid', data.openid);
            if (data.token) {
              wx.setStorageSync('token', data.token);
            }
            // Process pending activation/invite after login
            this.processPendingActions();
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

  onShow(options) {
    // Also check scene params on show (e.g., from share card)
    if (options && options.query) {
      if (options.query.activate) {
        wx.setStorageSync('pending_activate', options.query.activate);
      }
      if (options.query.invite) {
        wx.setStorageSync('pending_invite', options.query.invite);
      }
      // If already logged in, process immediately
      if (wx.getStorageSync('token')) {
        this.processPendingActions();
      }
    }
  },

  processPendingActions() {
    const activateCode = wx.getStorageSync('pending_activate');
    if (activateCode) {
      wx.removeStorageSync('pending_activate');
      request({
        url: API_ENDPOINTS.AUTHORIZE,
        method: 'POST',
        data: { code: activateCode }
      }).then((res: any) => {
        wx.showModal({
          title: '激活成功',
          content: `已成功激活付费账户，到期时间：${new Date(res.paid_until).toLocaleDateString()}`,
          showCancel: false,
        });
      }).catch((err: any) => {
        wx.showToast({
          title: err?.data?.error || '激活失败',
          icon: 'none',
          duration: 3000,
        });
      });
    }

    const inviteCode = wx.getStorageSync('pending_invite');
    if (inviteCode) {
      wx.removeStorageSync('pending_invite');
      request({
        url: API_ENDPOINTS.INVITE_USE,
        method: 'POST',
        data: { code: inviteCode }
      }).then((res: any) => {
        wx.showModal({
          title: '邀请绑定成功',
          content: res.message || '已绑定邀请人，享受付费用户权益',
          showCancel: false,
        });
      }).catch((err: any) => {
        wx.showToast({
          title: err?.data?.error || '邀请绑定失败',
          icon: 'none',
          duration: 3000,
        });
      });
    }
  },
})
