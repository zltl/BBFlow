// app.ts
import { request, ensureLogin } from './utils/request';
import { API_ENDPOINTS } from './config';

App<IAppOption>({
  globalData: {
    networkOffline: false,
  },
  onLaunch(options) {
    const logs = wx.getStorageSync('logs') || [];
    logs.unshift(Date.now());
    wx.setStorageSync('logs', logs);

    if (options && options.query) {
      if (options.query.activate) {
        wx.setStorageSync('pending_activate', options.query.activate);
      }
      if (options.query.invite) {
        wx.setStorageSync('pending_invite', options.query.invite);
      }
    }

    this.doLogin();
  },

  onShow(options) {
    if (options && options.query) {
      if (options.query.activate) {
        wx.setStorageSync('pending_activate', options.query.activate);
      }
      if (options.query.invite) {
        wx.setStorageSync('pending_invite', options.query.invite);
      }
      if (wx.getStorageSync('token')) {
        this.processPendingActions();
      }
    }
  },

  doLogin() {
    ensureLogin()
      .then((token) => {
        if (token) {
          this.globalData.networkOffline = false;
          wx.removeStorageSync('network_offline');
          this.processPendingActions();
          return;
        }
        this.globalData.networkOffline = true;
        wx.setStorageSync('network_offline', true);
        // Do not invent a fake openid — pages should show offline guidance
        wx.showToast({
          title: '网络不可用，请稍后重试',
          icon: 'none',
          duration: 2500,
        });
      })
      .catch(() => {
        this.globalData.networkOffline = true;
        wx.setStorageSync('network_offline', true);
      });
  },

  processPendingActions() {
    const activateCode = wx.getStorageSync('pending_activate');
    if (activateCode) {
      wx.removeStorageSync('pending_activate');
      request({
        url: API_ENDPOINTS.AUTHORIZE,
        method: 'POST',
        data: { code: activateCode },
      })
        .then((res: any) => {
          wx.showModal({
            title: '激活成功',
            content: `已成功激活付费账户，到期时间：${new Date(res.paid_until).toLocaleDateString()}`,
            showCancel: false,
          });
        })
        .catch((err: any) => {
          wx.showToast({
            title: err?.data?.error || err?.message || '激活失败',
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
        data: { code: inviteCode },
      })
        .then((res: any) => {
          wx.showModal({
            title: '邀请绑定成功',
            content: res.message || '已绑定邀请人，享受付费用户权益',
            showCancel: false,
          });
        })
        .catch((err: any) => {
          wx.showToast({
            title: err?.data?.error || err?.message || '邀请绑定失败',
            icon: 'none',
            duration: 3000,
          });
        });
    }
  },
});
