/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
    networkOffline?: boolean,
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback,
  processPendingActions(): void,
  doLogin(): void,
}

declare namespace WechatMiniprogram {
  interface Wx {
    shareFileMessage(opts: {
      filePath: string;
      fileName?: string;
      success?: (res: any) => void;
      fail?: (err: any) => void;
      complete?: () => void;
    }): void;
  }
}